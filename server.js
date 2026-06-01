#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const rootDir = __dirname;
loadEnvFile(path.join(rootDir, ".env"));

const config = {
  authSecret: process.env.AUTH_SECRET || "",
  cookieName: process.env.AUTH_COOKIE_NAME || "azm_session",
  cookieSecure:
    process.env.COOKIE_SECURE === "1" ||
    process.env.NODE_ENV === "production" ||
    /^https:\/\//i.test(process.env.PUBLIC_BASE_URL || ""),
  host: process.env.HOST || "0.0.0.0",
  magicLinkTtlMs: readPositiveNumber(process.env.MAGIC_LINK_TTL_MINUTES, 15) * 60 * 1000,
  mailFrom: process.env.MAIL_FROM || "Asistent za Mature <noreply@localhost>",
  mailTransport: process.env.MAIL_TRANSPORT || (process.env.SMTP_HOST ? "smtp" : "log"),
  port: Number(process.env.PORT || 8080),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  sessionTtlMs: readPositiveNumber(process.env.SESSION_TTL_DAYS, 30) * 24 * 60 * 60 * 1000,
  storeFile: path.resolve(rootDir, process.env.AUTH_STORE_FILE || "var/auth-store.json"),
};

const rateLimit = {
  email: createRateLimiter({
    max: Number(process.env.AUTH_EMAIL_LIMIT_PER_HOUR || 5),
    windowMs: 60 * 60 * 1000,
  }),
  ip: createRateLimiter({
    max: Number(process.env.AUTH_IP_LIMIT_PER_HOUR || 25),
    windowMs: 60 * 60 * 1000,
  }),
};

let store = {
  magicLinks: {},
  sessions: {},
  users: {},
};
let writeQueue = Promise.resolve();

main().catch((error) => {
  console.error("Ne mogu pokrenuti server:", error);
  process.exit(1);
});

async function main() {
  store = await loadStore();
  pruneExpiredRecords();
  await persistStore();

  if (!config.authSecret && process.env.NODE_ENV === "production") {
    console.warn("Upozorenje: AUTH_SECRET nije postavljen. Postavi ga prije produkcije.");
  }

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error(error);
      sendJson(response, 500, { error: "Došlo je do pogreške na serveru." });
    });
  });

  server.listen(config.port, config.host, () => {
    console.log(`Asistent za Mature radi na http://${config.host}:${config.port}`);
    console.log(`Mail transport: ${config.mailTransport}`);
    if (config.mailTransport === "log") {
      console.log("Magic linkovi se ispisuju u ovaj log. To nije produkcijski način slanja.");
    }
  });
}

async function handleRequest(request, response) {
  const url = new URL(request.url, requestBaseUrl(request));

  if (url.pathname === "/api/auth/magic-link") {
    await handleMagicLinkRequest(request, response);
    return;
  }

  if (url.pathname === "/api/auth/me") {
    await handleCurrentUser(request, response);
    return;
  }

  if (url.pathname === "/api/auth/logout") {
    await handleLogout(request, response);
    return;
  }

  if (url.pathname === "/auth/verify") {
    await handleVerifyMagicLink(request, response, url);
    return;
  }

  await serveStaticFile(request, response, url);
}

async function handleMagicLinkRequest(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Metoda nije dopuštena." }, { Allow: "POST" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "Zahtjev nije ispravan." });
    return;
  }

  const email = normalizeSkoleEmail(body.email);
  if (!email) {
    sendJson(response, 400, { error: "Za prijavu koristi adresu oblika ime.prezime@skole.hr." });
    return;
  }

  const ipAddress = clientIp(request);
  if (!rateLimit.ip.check(ipAddress) || !rateLimit.email.check(email)) {
    sendJson(response, 429, {
      error: "Poslano je previše zahtjeva. Pričekaj nekoliko minuta i pokušaj ponovno.",
    });
    return;
  }

  pruneExpiredRecords();

  const token = randomToken();
  const magicLink = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    email,
    expiresAt: new Date(Date.now() + config.magicLinkTtlMs).toISOString(),
    ipAddress,
    returnTo: safeReturnTo(body.returnTo),
    tokenHash: hashToken(token),
    usedAt: null,
    userAgent: String(request.headers["user-agent"] || "").slice(0, 500),
  };

  store.magicLinks[magicLink.id] = magicLink;
  await persistStore();

  const link = new URL("/auth/verify", externalBaseUrl(request));
  link.searchParams.set("token", token);

  try {
    await sendMagicLinkEmail({ email, link: link.toString() });
  } catch (error) {
    console.error("Slanje magic linka nije uspjelo:", error);
    sendJson(response, 502, {
      error: "Prijava je pripremljena, ali slanje e-maila trenutno nije uspjelo.",
    });
    return;
  }

  sendJson(response, 200, {
    ok: true,
    message: "Ako je adresa ispravna, poveznica za prijavu poslana je na @skole.hr e-mail.",
  });
}

async function handleVerifyMagicLink(request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    redirect(response, "/", 303);
    return;
  }

  const tokenHash = hashToken(url.searchParams.get("token") || "");
  const now = Date.now();
  const magicLink = Object.values(store.magicLinks).find((item) => {
    return item.tokenHash === tokenHash && !item.usedAt && Date.parse(item.expiresAt) > now;
  });

  if (!magicLink) {
    redirect(response, "/?prijava=neuspjela#predmeti", 303);
    return;
  }

  magicLink.usedAt = new Date().toISOString();
  const user = findOrCreateUser(magicLink.email);
  user.lastLoginAt = new Date().toISOString();

  const sessionToken = randomToken();
  const session = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + config.sessionTtlMs).toISOString(),
    lastSeenAt: new Date().toISOString(),
    tokenHash: hashToken(sessionToken),
    userId: user.id,
  };
  store.sessions[session.id] = session;
  pruneExpiredRecords();
  await persistStore();

  redirect(response, magicLink.returnTo || "/", 303, {
    "Set-Cookie": sessionCookie(sessionToken, config.sessionTtlMs),
  });
}

async function handleCurrentUser(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "Metoda nije dopuštena." }, { Allow: "GET" });
    return;
  }

  const session = currentSession(request);
  if (!session) {
    sendJson(response, 200, { authenticated: false });
    return;
  }

  const user = store.users[session.userId];
  if (!user) {
    delete store.sessions[session.id];
    await persistStore();
    sendJson(response, 200, { authenticated: false });
    return;
  }

  session.lastSeenAt = new Date().toISOString();
  await persistStore();

  sendJson(response, 200, {
    authenticated: true,
    user: {
      email: user.email,
      id: user.id,
    },
  });
}

async function handleLogout(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Metoda nije dopuštena." }, { Allow: "POST" });
    return;
  }

  const session = currentSession(request);
  if (session) {
    delete store.sessions[session.id];
    await persistStore();
  }

  sendJson(response, 200, { ok: true }, { "Set-Cookie": expiredSessionCookie() });
}

function findOrCreateUser(email) {
  const existing = Object.values(store.users).find((user) => user.email === email);
  if (existing) return existing;

  const user = {
    createdAt: new Date().toISOString(),
    email,
    id: crypto.randomUUID(),
    lastLoginAt: null,
  };
  store.users[user.id] = user;
  return user;
}

function currentSession(request) {
  const token = parseCookies(request.headers.cookie || "")[config.cookieName];
  if (!token) return null;

  const tokenHash = hashToken(token);
  const now = Date.now();
  for (const session of Object.values(store.sessions)) {
    if (session.tokenHash !== tokenHash) continue;
    if (Date.parse(session.expiresAt) <= now) {
      delete store.sessions[session.id];
      return null;
    }
    return session;
  }

  return null;
}

async function serveStaticFile(request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Metoda nije dopuštena.");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400);
    response.end("Neispravna putanja.");
    return;
  }

  if (pathname === "/") pathname = "/index.html";

  if (!isPublicPath(pathname)) {
    response.writeHead(404);
    response.end("Datoteka nije pronađena.");
    return;
  }

  const filePath = path.resolve(rootDir, `.${pathname}`);
  if (!filePath.startsWith(rootDir + path.sep)) {
    response.writeHead(403);
    response.end("Pristup nije dopušten.");
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    response.writeHead(404);
    response.end("Datoteka nije pronađena.");
    return;
  }

  if (stat.isDirectory()) {
    response.writeHead(403);
    response.end("Pristup direktoriju nije dopušten.");
    return;
  }

  const headers = {
    "Cache-Control": cacheHeaderFor(filePath),
    "Content-Length": stat.size,
    "Content-Type": contentType(filePath),
    "X-Content-Type-Options": "nosniff",
  };

  response.writeHead(200, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }

  fs.createReadStream(filePath).pipe(response);
}

async function sendMagicLinkEmail({ email, link }) {
  const subject = "Prijava u Asistent za Mature";
  const text = [
    "Pozdrav,",
    "",
    "Za prijavu u Asistent za Mature otvori ovu poveznicu:",
    link,
    "",
    "Poveznica vrijedi kratko i može se iskoristiti samo jednom.",
    "Ovo je neslužbeni projekt i nije AAI@EduHr prijava.",
  ].join("\n");
  const html = `
    <p>Pozdrav,</p>
    <p>Za prijavu u Asistent za Mature otvori ovu poveznicu:</p>
    <p><a href="${escapeHtml(link)}">Prijavi se u Asistent za Mature</a></p>
    <p>Poveznica vrijedi kratko i može se iskoristiti samo jednom.</p>
    <p>Ovo je neslužbeni projekt i nije AAI@EduHr prijava.</p>
  `;

  if (config.mailTransport === "log") {
    console.log("");
    console.log("=== MAGIC LINK ZA TESTIRANJE ===");
    console.log(`Za: ${email}`);
    console.log(link);
    console.log("================================");
    console.log("");
    return;
  }

  if (config.mailTransport === "sendmail") {
    await sendWithSendmail({ email, subject, text });
    return;
  }

  if (config.mailTransport === "smtp") {
    await sendWithSmtp({ email, html, subject, text });
    return;
  }

  throw new Error(`Nepoznat MAIL_TRANSPORT: ${config.mailTransport}`);
}

async function sendWithSmtp({ email, html, subject, text }) {
  let nodemailer;
  try {
    nodemailer = await import("nodemailer");
  } catch {
    throw new Error("SMTP traži nodemailer. Pokreni `npm install` ili koristi MAIL_TRANSPORT=sendmail.");
  }

  const mailer = nodemailer.default || nodemailer;
  const transporter = mailer.createTransport({
    auth:
      process.env.SMTP_USER || process.env.SMTP_PASS
        ? {
            pass: process.env.SMTP_PASS || "",
            user: process.env.SMTP_USER || "",
          }
        : undefined,
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "1",
  });

  await transporter.sendMail({
    from: config.mailFrom,
    html,
    subject,
    text,
    to: email,
  });
}

function sendWithSendmail({ email, subject, text }) {
  const sendmailPath = process.env.SENDMAIL_PATH || "/usr/sbin/sendmail";
  const message = [
    `From: ${config.mailFrom}`,
    `To: ${email}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    text,
  ].join("\n");

  return new Promise((resolve, reject) => {
    const child = spawn(sendmailPath, ["-t"], {
      stdio: ["pipe", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`sendmail je završio s kodom ${code}: ${stderr}`));
      }
    });

    child.stdin.end(message);
  });
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) throw new Error("Zahtjev je prevelik.");
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=UTF-8",
    ...headers,
  });
  response.end(body);
}

function redirect(response, location, statusCode = 303, headers = {}) {
  response.writeHead(statusCode, { Location: location, ...headers });
  response.end();
}

function normalizeSkoleEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@skole\.hr$/.test(email)) return null;
  return email;
}

function safeReturnTo(value) {
  const raw = String(value || "").trim();
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (/[\r\n]/.test(raw)) return "/";
  return raw.slice(0, 700);
}

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return crypto
    .createHmac("sha256", config.authSecret || "asistent-za-mature-dev-secret")
    .update(String(token))
    .digest("base64url");
}

function parseCookies(header) {
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function sessionCookie(token, ttlMs) {
  const parts = [
    `${config.cookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(ttlMs / 1000)}`,
  ];
  if (config.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

function expiredSessionCookie() {
  const parts = [`${config.cookieName}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (config.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

async function loadStore() {
  try {
    const raw = await fsp.readFile(config.storeFile, "utf8");
    const parsed = JSON.parse(raw);
    return {
      magicLinks: parsed.magicLinks || {},
      sessions: parsed.sessions || {},
      users: parsed.users || {},
    };
  } catch (error) {
    if (error.code === "ENOENT") return { magicLinks: {}, sessions: {}, users: {} };
    throw error;
  }
}

function persistStore() {
  writeQueue = writeQueue.then(async () => {
    await fsp.mkdir(path.dirname(config.storeFile), { recursive: true });
    const tempFile = `${config.storeFile}.tmp`;
    await fsp.writeFile(tempFile, `${JSON.stringify(store, null, 2)}\n`);
    await fsp.rename(tempFile, config.storeFile);
  });
  return writeQueue;
}

function pruneExpiredRecords() {
  const now = Date.now();
  for (const [id, magicLink] of Object.entries(store.magicLinks)) {
    const expiredForADay = Date.parse(magicLink.expiresAt) + 24 * 60 * 60 * 1000 <= now;
    if (expiredForADay || magicLink.usedAt) delete store.magicLinks[id];
  }

  for (const [id, session] of Object.entries(store.sessions)) {
    if (Date.parse(session.expiresAt) <= now) delete store.sessions[id];
  }
}

function createRateLimiter({ max, windowMs }) {
  const buckets = new Map();

  return {
    check(key) {
      const now = Date.now();
      const bucket = (buckets.get(key) || []).filter((timestamp) => timestamp + windowMs > now);
      bucket.push(now);
      buckets.set(key, bucket);
      return bucket.length <= max;
    },
  };
}

function externalBaseUrl(request) {
  return config.publicBaseUrl || requestBaseUrl(request);
}

function requestBaseUrl(request) {
  const proto = request.headers["x-forwarded-proto"] || "http";
  const host = request.headers["x-forwarded-host"] || request.headers.host || `localhost:${config.port}`;
  return `${String(proto).split(",")[0]}://${String(host).split(",")[0]}`;
}

function clientIp(request) {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "")
    .split(",")[0]
    .trim();
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".css": "text/css; charset=UTF-8",
      ".html": "text/html; charset=UTF-8",
      ".js": "text/javascript; charset=UTF-8",
      ".json": "application/json; charset=UTF-8",
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
      ".zip": "application/zip",
    }[ext] || "application/octet-stream"
  );
}

function isPublicPath(pathname) {
  if (pathname.includes("/.")) return false;

  const publicFiles = new Set([
    "/app.js",
    "/asistent_za_maturu.png",
    "/auth-client.js",
    "/english-reading.html",
    "/english-reading.js",
    "/engleski-citanje.html",
    "/index.html",
    "/site-header.js",
    "/styles.css",
  ]);

  return (
    publicFiles.has(pathname) ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/data/") ||
    pathname.startsWith("/files/")
  );
}

function cacheHeaderFor(filePath) {
  const relativePath = path.relative(rootDir, filePath).replaceAll(path.sep, "/");
  if (relativePath.startsWith("files/") || relativePath.startsWith("assets/")) {
    return "public, max-age=86400";
  }
  return "no-cache";
}

function readPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
