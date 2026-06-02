#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

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
  port: Number(process.env.PORT || 8080),
  sessionTtlMs: readPositiveNumber(process.env.SESSION_TTL_DAYS, 30) * 24 * 60 * 60 * 1000,
  storeFile: path.resolve(rootDir, process.env.AUTH_STORE_FILE || "var/auth-store.json"),
};

const rateLimit = {
  account: createRateLimiter({
    max: Number(process.env.AUTH_ACCOUNT_LIMIT_PER_HOUR || 20),
    windowMs: 60 * 60 * 1000,
  }),
  ip: createRateLimiter({
    max: Number(process.env.AUTH_IP_LIMIT_PER_HOUR || 80),
    windowMs: 60 * 60 * 1000,
  }),
};

let store = {
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
    console.log(`Auth store: ${config.storeFile}`);
  });
}

async function handleRequest(request, response) {
  const url = new URL(request.url, requestBaseUrl(request));

  if (url.pathname === "/api/auth/signup") {
    await handleSignup(request, response);
    return;
  }

  if (url.pathname === "/api/auth/login") {
    await handleLogin(request, response);
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

  await serveStaticFile(request, response, url);
}

async function handleSignup(request, response) {
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
    sendJson(response, 400, { error: "Za račun koristi adresu koja završava s @skole.hr." });
    return;
  }

  const password = normalizePassword(body.password);
  if (!password) {
    sendJson(response, 400, { error: "Upiši lozinku za ovaj prototip." });
    return;
  }

  const ipAddress = clientIp(request);
  if (!rateLimit.ip.check(ipAddress) || !rateLimit.account.check(email)) {
    sendJson(response, 429, {
      error: "Poslano je previše zahtjeva. Pričekaj nekoliko minuta i pokušaj ponovno.",
    });
    return;
  }

  pruneExpiredRecords();

  if (findUserByEmail(email)) {
    sendJson(response, 409, { error: "Račun već postoji. Prijavi se istom adresom i lozinkom." });
    return;
  }

  const user = await createUser({ email, password });
  user.lastLoginAt = new Date().toISOString();
  const { cookie, session } = createSession(user, request);
  store.sessions[session.id] = session;
  await persistStore();

  sendJson(response, 201, authenticatedPayload(user, "Račun je napravljen."), {
    "Set-Cookie": cookie,
  });
}

async function handleLogin(request, response) {
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
  const password = normalizePassword(body.password);
  if (!email || !password) {
    sendJson(response, 400, { error: "Upiši @skole.hr adresu i lozinku." });
    return;
  }

  const ipAddress = clientIp(request);
  if (!rateLimit.ip.check(ipAddress) || !rateLimit.account.check(email)) {
    sendJson(response, 429, {
      error: "Poslano je previše zahtjeva. Pričekaj nekoliko minuta i pokušaj ponovno.",
    });
    return;
  }

  pruneExpiredRecords();

  const user = findUserByEmail(email);
  const isValid = user ? await verifyPassword(user, password) : false;
  if (!user || !isValid) {
    sendJson(response, 401, { error: "Račun ne postoji ili lozinka nije točna." });
    return;
  }

  user.lastLoginAt = new Date().toISOString();
  const { cookie, session } = createSession(user, request);
  store.sessions[session.id] = session;
  await persistStore();

  sendJson(response, 200, authenticatedPayload(user, "Prijavljen si."), {
    "Set-Cookie": cookie,
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
    user: publicUser(user),
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

function findUserByEmail(email) {
  return Object.values(store.users).find((user) => user.email === email) || null;
}

async function createUser({ email, password }) {
  const passwordRecord = await hashPassword(password);
  const user = {
    createdAt: new Date().toISOString(),
    email,
    id: crypto.randomUUID(),
    lastLoginAt: null,
    passwordHash: passwordRecord.hash,
    passwordSalt: passwordRecord.salt,
    passwordUpdatedAt: new Date().toISOString(),
  };
  store.users[user.id] = user;
  return user;
}

function createSession(user, request) {
  const sessionToken = randomToken();
  const now = new Date().toISOString();
  const session = {
    createdAt: now,
    expiresAt: new Date(Date.now() + config.sessionTtlMs).toISOString(),
    id: crypto.randomUUID(),
    ipAddress: clientIp(request),
    lastSeenAt: now,
    tokenHash: hashToken(sessionToken),
    userAgent: String(request.headers["user-agent"] || "").slice(0, 500),
    userId: user.id,
  };

  return {
    cookie: sessionCookie(sessionToken, config.sessionTtlMs),
    session,
  };
}

function authenticatedPayload(user, message) {
  return {
    authenticated: true,
    message,
    ok: true,
    user: publicUser(user),
  };
}

function publicUser(user) {
  return {
    email: user.email,
    id: user.id,
  };
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

function normalizeSkoleEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@skole\.hr$/.test(email)) return null;
  return email;
}

function normalizePassword(value) {
  if (typeof value !== "string") return null;
  if (!value || value.length > 200) return null;
  return value;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = await scrypt(password, salt);
  return { hash, salt };
}

async function verifyPassword(user, password) {
  if (!user.passwordHash || !user.passwordSalt) return false;
  const hash = await scrypt(password, user.passwordSalt);
  return timingSafeEqual(hash, user.passwordHash);
}

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), String(salt), 64, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key.toString("base64url"));
    });
  });
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
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
      sessions: parsed.sessions || {},
      users: parsed.users || {},
    };
  } catch (error) {
    if (error.code === "ENOENT") return { sessions: {}, users: {} };
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
    "/croatian-choice.js",
    "/english-reading.html",
    "/english-reading.js",
    "/english-listening.js",
    "/engleski-citanje.html",
    "/engleski-slusanje.html",
    "/exam-simulation.js",
    "/fizika-abcd.html",
    "/fizika.html",
    "/hrvatski.html",
    "/index.html",
    "/physics-choice.js",
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
