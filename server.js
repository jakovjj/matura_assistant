#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const rootDir = __dirname;
loadEnvFile(path.join(rootDir, ".env"));

const config = {
  agentKeyEncryptionSecret: process.env.AGENT_KEY_ENCRYPTION_SECRET || "",
  authSecret: process.env.AUTH_SECRET || "",
  cookieName: process.env.AUTH_COOKIE_NAME || "azm_session",
  cookieSecure:
    process.env.COOKIE_SECURE === "1" ||
    process.env.NODE_ENV === "production" ||
    /^https:\/\//i.test(process.env.PUBLIC_BASE_URL || ""),
  essayModel: process.env.OPENAI_ESSAY_MODEL || "gpt-4.1-mini",
  host: process.env.HOST || "0.0.0.0",
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || "",
  oauthCookieName: process.env.AUTH_OAUTH_COOKIE_NAME || "azm_google_oauth",
  port: Number(process.env.PORT || 8080),
  publicBaseUrl: String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, ""),
  sessionTtlMs: readPositiveNumber(process.env.SESSION_TTL_DAYS, 30) * 24 * 60 * 60 * 1000,
  databaseFile: path.resolve(rootDir, process.env.DATABASE_FILE || "var/asistent-za-mature.sqlite"),
  legacyStoreFile: path.resolve(rootDir, process.env.AUTH_STORE_FILE || "var/auth-store.json"),
};

const rateLimit = {
  ip: createRateLimiter({
    max: Number(process.env.AUTH_IP_LIMIT_PER_HOUR || 80),
    windowMs: 60 * 60 * 1000,
  }),
};
const englishEssayIndex = {
  file: path.join(rootDir, "data", "english-essay.js"),
  prefix: "window.ASISTENT_ZA_MATURE_ENGLISH_ESSAY=",
};
const essayScoreSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    taskCompletion: { type: "integer" },
    coherenceCohesion: { type: "integer" },
    vocabulary: { type: "integer" },
    grammar: { type: "integer" },
    wordCount: { type: "integer" },
    insufficientLength: { type: "boolean" },
  },
  required: [
    "taskCompletion",
    "coherenceCohesion",
    "vocabulary",
    "grammar",
    "wordCount",
    "insufficientLength",
  ],
};
const essayOcrSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: { type: "string" },
  },
  required: ["text"],
};

let store = {
  sessions: {},
  users: {},
};
let database;

main().catch((error) => {
  console.error("Ne mogu pokrenuti server:", error);
  process.exit(1);
});

async function main() {
  await initializeDatabase();
  store = loadStore();
  await migrateLegacyStore();
  pruneExpiredRecords();
  await persistStore();

  if (!config.authSecret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET mora biti postavljen prije produkcijskog pokretanja.");
    }
    console.warn("Upozorenje: AUTH_SECRET nije postavljen. Koristim samo razvojni fallback.");
  }
  if (!config.agentKeyEncryptionSecret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AGENT_KEY_ENCRYPTION_SECRET mora biti postavljen prije produkcijskog pokretanja.",
      );
    }
    console.warn(
      "Upozorenje: AGENT_KEY_ENCRYPTION_SECRET nije postavljen. Koristim samo razvojni fallback.",
    );
  }
  if (
    process.env.NODE_ENV === "production" &&
    googleAuthEnabled() &&
    !config.googleRedirectUri &&
    !config.publicBaseUrl
  ) {
    throw new Error("Postavi GOOGLE_REDIRECT_URI ili PUBLIC_BASE_URL prije produkcijskog pokretanja.");
  }
  if (!googleAuthEnabled()) {
    console.warn("Upozorenje: Google prijava nije omogućena. Postavi GOOGLE_CLIENT_ID i GOOGLE_CLIENT_SECRET.");
  }

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error(error);
      sendJson(response, 500, { error: "Došlo je do pogreške na serveru." });
    });
  });

  server.listen(config.port, config.host, () => {
    console.log(`Asistent za Mature radi na http://${config.host}:${config.port}`);
    console.log(`Baza podataka: ${config.databaseFile}`);
  });
}

async function handleRequest(request, response) {
  const url = new URL(request.url, requestBaseUrl(request));

  if (url.pathname === "/api/auth/config") {
    handleAuthConfig(request, response);
    return;
  }

  if (url.pathname === "/api/auth/google") {
    handleGoogleLogin(request, response, url);
    return;
  }

  if (url.pathname === "/api/auth/google/callback") {
    await handleGoogleCallback(request, response, url);
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

  if (url.pathname === "/api/profile/simulations") {
    await handleProfileSimulations(request, response);
    return;
  }

  if (url.pathname === "/api/profile/agent-key") {
    await handleProfileAgentKey(request, response);
    return;
  }

  if (url.pathname === "/api/english-essay/grade") {
    await handleEnglishEssayGrade(request, response);
    return;
  }

  if (url.pathname === "/api/english-essay/ocr") {
    await handleEnglishEssayOcr(request, response);
    return;
  }

  await serveStaticFile(request, response, url);
}

function handleAuthConfig(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "Metoda nije dopuštena." }, { Allow: "GET" });
    return;
  }

  sendJson(response, 200, {
    google: {
      enabled: googleAuthEnabled(),
    },
  });
}

function handleGoogleLogin(request, response, url) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Metoda nije dopuštena." }, { Allow: "GET" });
    return;
  }

  if (!googleAuthEnabled()) {
    redirectToLogin(response, "oauth_unavailable", expiredOAuthStateCookie());
    return;
  }

  const ipAddress = clientIp(request);
  if (!rateLimit.ip.check(ipAddress)) {
    sendJson(response, 429, {
      error: "Poslano je previše zahtjeva. Pričekaj nekoliko minuta i pokušaj ponovno.",
    });
    return;
  }

  const oauthState = createOAuthState(normalizeReturnPath(url.searchParams.get("next")));
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.search = new URLSearchParams({
    client_id: config.googleClientId,
    code_challenge: sha256Base64Url(oauthState.codeVerifier),
    code_challenge_method: "S256",
    nonce: oauthState.nonce,
    prompt: "select_account",
    redirect_uri: googleRedirectUri(request),
    response_type: "code",
    scope: "openid profile email",
    state: oauthState.state,
  }).toString();

  redirect(response, authorizationUrl.toString(), {
    "Set-Cookie": oauthStateCookie(oauthState),
  });
}

async function handleGoogleCallback(request, response, url) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Metoda nije dopuštena." }, { Allow: "GET" });
    return;
  }

  const clearOAuthCookie = expiredOAuthStateCookie();
  if (!googleAuthEnabled()) {
    redirectToLogin(response, "oauth_unavailable", clearOAuthCookie);
    return;
  }

  const oauthState = readOAuthState(request);
  if (url.searchParams.get("error")) {
    redirectToLogin(response, "oauth_denied", clearOAuthCookie, oauthState?.next);
    return;
  }

  if (!oauthState || !safeEqual(url.searchParams.get("state"), oauthState.state)) {
    redirectToLogin(response, "oauth_state", clearOAuthCookie);
    return;
  }

  const code = url.searchParams.get("code");
  if (!code) {
    redirectToLogin(response, "oauth_code", clearOAuthCookie);
    return;
  }

  let profile;
  try {
    const token = await exchangeGoogleCode(code, oauthState.codeVerifier, request);
    profile = readGoogleProfile(token.id_token, oauthState.nonce);
  } catch (error) {
    console.error("Google OAuth callback nije uspio:", error.message);
    redirectToLogin(response, "oauth_exchange", clearOAuthCookie, oauthState.next);
    return;
  }

  const user = upsertGoogleUser(profile);
  const { cookie, session } = createSession(user, request);
  store.sessions[session.id] = session;
  await persistStore();

  redirect(response, oauthState.next, {
    "Set-Cookie": [cookie, clearOAuthCookie],
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

async function handleProfileSimulations(request, response) {
  if (!["GET", "HEAD", "POST"].includes(request.method)) {
    sendJson(response, 405, { error: "Metoda nije dopuštena." }, { Allow: "GET, POST" });
    return;
  }

  const session = currentSession(request);
  const user = session ? store.users[session.userId] : null;
  if (!session || !user) {
    sendJson(response, 401, { error: "Prijava je potrebna." });
    return;
  }

  if (!Array.isArray(user.simulationAttempts)) user.simulationAttempts = [];

  if (request.method === "GET" || request.method === "HEAD") {
    sendJson(response, 200, { simulations: user.simulationAttempts });
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "Zahtjev nema ispravan JSON zapis." });
    return;
  }

  const attempt = normalizeSimulationAttempt(body?.attempt || body);
  if (!attempt) {
    sendJson(response, 400, { error: "Zapis simulacije nije ispravan." });
    return;
  }

  user.simulationAttempts = [
    attempt,
    ...user.simulationAttempts.filter((storedAttempt) => storedAttempt.id !== attempt.id),
  ].slice(0, 200);
  user.updatedAt = new Date().toISOString();
  await persistStore();

  sendJson(response, 201, {
    attempt,
    simulations: user.simulationAttempts,
  });
}

async function handleProfileAgentKey(request, response) {
  if (!["GET", "HEAD", "PUT", "DELETE"].includes(request.method)) {
    sendJson(response, 405, { error: "Metoda nije dopuštena." }, { Allow: "GET, PUT, DELETE" });
    return;
  }

  const session = currentSession(request);
  const user = session ? store.users[session.userId] : null;
  if (!session || !user) {
    sendJson(response, 401, { error: "Prijava je potrebna." });
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    sendJson(response, 200, { agentKey: publicAgentKey(user.agentKey) });
    return;
  }

  if (request.method === "DELETE") {
    delete user.agentKey;
    user.updatedAt = new Date().toISOString();
    await persistStore();
    sendJson(response, 200, { agentKey: publicAgentKey(null) });
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "Zahtjev nema ispravan JSON zapis." });
    return;
  }

  const apiKey = normalizeOpenAiApiKey(body?.apiKey);
  if (!apiKey) {
    sendJson(response, 400, {
      error: "Upiši ispravan OpenAI API ključ bez razmaka.",
    });
    return;
  }

  user.agentKey = encryptAgentKey(apiKey);
  user.updatedAt = new Date().toISOString();
  await persistStore();

  sendJson(response, 200, { agentKey: publicAgentKey(user.agentKey) });
}

async function handleEnglishEssayGrade(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Metoda nije dopuštena." }, { Allow: "POST" });
    return;
  }

  const session = currentSession(request);
  const user = session ? store.users[session.userId] : null;
  if (!session || !user) {
    sendJson(response, 401, { error: "Prijava je potrebna za ocjenjivanje eseja." });
    return;
  }

  let apiKey;
  try {
    apiKey = decryptAgentKey(user.agentKey);
  } catch (error) {
    console.error("OpenAI API ključ nije moguće pročitati:", error.message);
    sendJson(response, 400, { error: "Spremljeni OpenAI API ključ nije moguće pročitati." });
    return;
  }

  if (!apiKey) {
    sendJson(response, 400, { error: "Spremi OpenAI API ključ u profilu prije ocjenjivanja." });
    return;
  }

  let body;
  try {
    body = await readJsonBody(request, 12 * 1024 * 1024);
  } catch {
    sendJson(response, 400, { error: "Zahtjev nema ispravan JSON zapis." });
    return;
  }

  const examId = stringOrEmpty(body?.examId);
  const essayText = normalizeEssayText(body?.essayText);
  const image = normalizeEssayImage(body?.image);
  if (body?.image && !image) {
    sendJson(response, 400, { error: "Fotografija eseja nije ispravna ili je prevelika." });
    return;
  }
  if (!essayText && !image) {
    sendJson(response, 400, { error: "Pošalji tekst eseja ili fotografiju rukopisa." });
    return;
  }

  const essayExam = loadEnglishEssayExam(examId);
  if (!essayExam) {
    sendJson(response, 404, { error: "Odabrani esej nije dostupan." });
    return;
  }

  try {
    const grade = await gradeEnglishEssayWithOpenAI({
      apiKey,
      essayExam,
      essayText,
      image,
    });
    sendJson(response, 200, {
      grade,
      model: config.essayModel,
    });
  } catch (error) {
    console.error("Ocjenjivanje eseja nije uspjelo:", error.message);
    sendJson(response, 502, {
      error: "OpenAI ocjenjivanje nije uspjelo. Provjeri API ključ i pokušaj ponovno.",
    });
  }
}

async function handleEnglishEssayOcr(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Metoda nije dopuštena." }, { Allow: "POST" });
    return;
  }

  const session = currentSession(request);
  const user = session ? store.users[session.userId] : null;
  if (!session || !user) {
    sendJson(response, 401, { error: "Prijava je potrebna za OCR fotografije." });
    return;
  }

  let apiKey;
  try {
    apiKey = decryptAgentKey(user.agentKey);
  } catch (error) {
    console.error("OpenAI API ključ nije moguće pročitati:", error.message);
    sendJson(response, 400, { error: "Spremljeni OpenAI API ključ nije moguće pročitati." });
    return;
  }

  if (!apiKey) {
    sendJson(response, 400, { error: "Spremi OpenAI API ključ u profilu prije OCR-a." });
    return;
  }

  let body;
  try {
    body = await readJsonBody(request, 12 * 1024 * 1024);
  } catch {
    sendJson(response, 400, { error: "Zahtjev nema ispravan JSON zapis." });
    return;
  }

  const image = normalizeEssayImage(body?.image);
  if (!image) {
    sendJson(response, 400, { error: "Fotografija eseja nije ispravna ili je prevelika." });
    return;
  }

  try {
    const text = await transcribeEnglishEssayImageWithOpenAI({ apiKey, image });
    sendJson(response, 200, {
      text,
      model: config.essayModel,
    });
  } catch (error) {
    console.error("OCR fotografije eseja nije uspio:", error.message);
    sendJson(response, 502, {
      error: "OpenAI OCR nije uspio. Provjeri API ključ i pokušaj ponovno.",
    });
  }
}

function upsertGoogleUser(profile) {
  const now = new Date().toISOString();
  let user =
    Object.values(store.users).find(
      (candidate) =>
        candidate.authProvider === "google" && candidate.googleSubject === profile.googleSubject,
    ) || null;

  if (!user) {
    user = {
      authProvider: "google",
      createdAt: now,
      id: crypto.randomUUID(),
    };
    store.users[user.id] = user;
  }

  user.displayName = profile.displayName;
  user.email = profile.email;
  user.emailVerified = true;
  user.googleSubject = profile.googleSubject;
  user.lastLoginAt = now;
  if (!Array.isArray(user.simulationAttempts)) user.simulationAttempts = [];
  user.updatedAt = now;
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

function publicUser(user) {
  return {
    createdAt: user.createdAt,
    displayName: user.displayName,
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

async function readJsonBody(request, maxBytes = 64 * 1024) {
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function normalizeSimulationAttempt(attempt) {
  if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) return null;

  const submittedAt = stringOrEmpty(attempt.submittedAt) || new Date().toISOString();
  const examId = stringOrEmpty(attempt.examId);
  const subject = stringOrEmpty(attempt.subject);
  if (!examId || !subject) return null;

  const score = numberOrNull(attempt.score);
  const maxScore = numberOrNull(attempt.maxScore);
  const percentage =
    score !== null && maxScore
      ? Math.round((score / maxScore) * 100)
      : numberOrNull(attempt.percentage);

  return {
    id: stringOrEmpty(attempt.id) || `sim-${Date.now()}-${crypto.randomUUID()}`,
    submittedAt,
    solver: stringOrEmpty(attempt.solver),
    subject,
    part: stringOrEmpty(attempt.part),
    examId,
    year: numberOrNull(attempt.year),
    term: stringOrEmpty(attempt.term),
    level: stringOrEmpty(attempt.level),
    schoolYear: stringOrEmpty(attempt.schoolYear),
    durationMinutes: numberOrNull(attempt.durationMinutes),
    answered: numberOrNull(attempt.answered),
    totalQuestions: numberOrNull(attempt.totalQuestions),
    score,
    maxScore,
    percentage,
    checkingSupported: attempt.checkingSupported !== false,
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

function normalizeOpenAiApiKey(value) {
  if (typeof value !== "string") return "";

  const trimmed = value.trim();
  if (trimmed.length < 20 || trimmed.length > 512) return "";
  return /^[\x21-\x7e]+$/.test(trimmed) ? trimmed : "";
}

function normalizeEssayText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").trim().slice(0, 20000);
}

function normalizeEssayImage(image) {
  if (!image || typeof image !== "object" || Array.isArray(image)) return null;

  const dataUrl = typeof image.dataUrl === "string" ? image.dataUrl.trim() : "";
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;

  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) return null;

  return {
    dataUrl,
    mimeType: match[1].toLowerCase().replace("image/jpg", "image/jpeg"),
  };
}

function loadEnglishEssayExam(examId) {
  if (!examId) return null;

  const source = fs.readFileSync(englishEssayIndex.file, "utf8").trim();
  if (!source.startsWith(englishEssayIndex.prefix) || !source.endsWith(";")) {
    throw new Error("English essay index has an unsupported format.");
  }

  const payload = JSON.parse(source.slice(englishEssayIndex.prefix.length, -1));
  const exams = Array.isArray(payload.exams) ? payload.exams : [];
  return exams.find((exam) => exam && exam.id === examId) || null;
}

async function gradeEnglishEssayWithOpenAI({ apiKey, essayExam, essayText, image }) {
  const content = [
    {
      type: "input_text",
      text: buildEssayGradingPrompt({ essayExam, essayText, hasImage: Boolean(image) }),
    },
  ];
  if (image) {
    content.push({
      type: "input_image",
      image_url: image.dataUrl,
      detail: "high",
    });
  }

  const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
    body: JSON.stringify({
      model: config.essayModel,
      input: [
        {
          role: "user",
          content,
        },
      ],
      max_output_tokens: 300,
      text: {
        format: {
          type: "json_schema",
          name: "english_essay_score",
          strict: true,
          schema: essayScoreSchema,
        },
      },
      temperature: 0,
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(45_000),
  });

  const payload = await openAiResponse.json().catch(() => ({}));
  if (!openAiResponse.ok) {
    const message = payload?.error?.message || `HTTP ${openAiResponse.status}`;
    throw new Error(`OpenAI response error: ${message}`);
  }

  const responseText = extractOpenAiOutputText(payload);
  if (!responseText) throw new Error("OpenAI response did not contain output text.");
  return normalizeEssayGrade(JSON.parse(responseText));
}

async function transcribeEnglishEssayImageWithOpenAI({ apiKey, image }) {
  const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
    body: JSON.stringify({
      model: config.essayModel,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `
Transcribe the English handwritten or photographed essay in the image.
Return only JSON matching the schema. Do not grade, correct, rewrite, or explain the text.
Preserve paragraph breaks where they are visible. If a word is uncertain, transcribe the most likely reading.
If the image does not contain an essay text, return an empty string.
              `.trim(),
            },
            {
              type: "input_image",
              image_url: image.dataUrl,
              detail: "high",
            },
          ],
        },
      ],
      max_output_tokens: 4000,
      text: {
        format: {
          type: "json_schema",
          name: "english_essay_ocr",
          strict: true,
          schema: essayOcrSchema,
        },
      },
      temperature: 0,
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(45_000),
  });

  const payload = await openAiResponse.json().catch(() => ({}));
  if (!openAiResponse.ok) {
    const message = payload?.error?.message || `HTTP ${openAiResponse.status}`;
    throw new Error(`OpenAI response error: ${message}`);
  }

  const responseText = extractOpenAiOutputText(payload);
  if (!responseText) throw new Error("OpenAI response did not contain output text.");

  const parsed = JSON.parse(responseText);
  return normalizeEssayText(parsed?.text);
}

function buildEssayGradingPrompt({ essayExam, essayText, hasImage }) {
  const sourceMode = essayText
    ? "Grade the typed essay below. Ignore the image unless the typed essay is empty."
    : hasImage
      ? "Read the handwritten or photographed essay from the image and grade it. Do not return a transcription."
      : "Grade the submitted essay.";

  return `
You score Croatian state graduation exam essays for English A level.
Return only JSON matching the schema. Do not return feedback, explanation, corrections, or prose.

Official task:
${essayExam.taskText}

Scoring criteria:
- taskCompletion: 0-5 for task fulfilment, relevant introduction, two developed views or for/against body points, conclusion, support with explanations/examples, and connection to the topic.
- coherenceCohesion: 0-5 for clear flow of ideas, paragraphing, and effective cohesive devices.
- vocabulary: 0-5 for range and accuracy of vocabulary, word form, and spelling.
- grammar: 0-5 for range and accuracy of grammatical structures.
- If the essay has fewer than 70 words, set all four criteria to 0 and insufficientLength to true.
- For 70-109, 110-139, 140-169, and 170-199 words, apply the official length penalty within taskCompletion.
- If taskCompletion is 0 because the text is off-topic or mostly unintelligible, set all other criteria to 0.
- If taskCompletion is 0 only because of length, other criteria may not exceed 1.
- If taskCompletion is 1 because of length, other criteria may not exceed 3.
- If taskCompletion is 2, other criteria may not exceed 4.

${sourceMode}

Typed essay:
${essayText || "(empty)"}
  `.trim();
}

function extractOpenAiOutputText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;

  const output = Array.isArray(payload.output) ? payload.output : [];
  const textParts = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const contentItem of content) {
      if (typeof contentItem?.text === "string") textParts.push(contentItem.text);
    }
  }

  return textParts.join("").trim();
}

function normalizeEssayGrade(rawGrade) {
  if (!rawGrade || typeof rawGrade !== "object" || Array.isArray(rawGrade)) {
    throw new Error("Essay grade is not an object.");
  }

  const taskCompletion = clampEssayCriterion(rawGrade.taskCompletion);
  let coherenceCohesion = clampEssayCriterion(rawGrade.coherenceCohesion);
  let vocabulary = clampEssayCriterion(rawGrade.vocabulary);
  let grammar = clampEssayCriterion(rawGrade.grammar);
  const wordCount = Math.max(0, Math.round(Number(rawGrade.wordCount) || 0));
  const insufficientLength = rawGrade.insufficientLength === true || wordCount < 70;

  if (insufficientLength) {
    return {
      taskCompletion: 0,
      coherenceCohesion: 0,
      vocabulary: 0,
      grammar: 0,
      total: 0,
      wordCount,
      insufficientLength: true,
    };
  }

  const maximumOtherCriterion =
    taskCompletion === 0 ? 0 : taskCompletion === 1 ? 3 : taskCompletion === 2 ? 4 : 5;
  coherenceCohesion = Math.min(coherenceCohesion, maximumOtherCriterion);
  vocabulary = Math.min(vocabulary, maximumOtherCriterion);
  grammar = Math.min(grammar, maximumOtherCriterion);

  return {
    taskCompletion,
    coherenceCohesion,
    vocabulary,
    grammar,
    total: taskCompletion + coherenceCohesion + vocabulary + grammar,
    wordCount,
    insufficientLength: false,
  };
}

function clampEssayCriterion(value) {
  const integer = Math.round(Number(value));
  if (!Number.isFinite(integer)) return 0;
  return Math.max(0, Math.min(5, integer));
}

function encryptAgentKey(apiKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", agentKeyEncryptionKey(), iv);
  cipher.setAAD(Buffer.from("asistent-za-mature:agent-key:v1:openai"));

  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return {
    algorithm: "aes-256-gcm",
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    keyHint: apiKey.slice(-4),
    provider: "openai",
    tag: cipher.getAuthTag().toString("base64url"),
    updatedAt: new Date().toISOString(),
    version: 1,
  };
}

function decryptAgentKey(agentKey) {
  const normalized = normalizeEncryptedAgentKey(agentKey);
  if (!normalized) return "";

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    agentKeyEncryptionKey(),
    Buffer.from(normalized.iv, "base64url"),
  );
  decipher.setAAD(Buffer.from("asistent-za-mature:agent-key:v1:openai"));
  decipher.setAuthTag(Buffer.from(normalized.tag, "base64url"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(normalized.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return normalizeOpenAiApiKey(plaintext);
}

function agentKeyEncryptionKey() {
  return crypto
    .createHash("sha256")
    .update("asistent-za-mature:agent-key-encryption:v1\0")
    .update(
      config.agentKeyEncryptionSecret ||
        config.authSecret ||
        "asistent-za-mature-dev-agent-key-secret",
    )
    .digest();
}

function publicAgentKey(agentKey) {
  const normalized = normalizeEncryptedAgentKey(agentKey);
  if (!normalized) {
    return {
      configured: false,
      provider: "openai",
    };
  }

  return {
    configured: true,
    maskedKey: `****${normalized.keyHint}`,
    provider: normalized.provider,
    updatedAt: normalized.updatedAt,
  };
}

function normalizeEncryptedAgentKey(agentKey) {
  if (!agentKey || typeof agentKey !== "object" || Array.isArray(agentKey)) return null;
  if (agentKey.version !== 1 || agentKey.algorithm !== "aes-256-gcm") return null;
  if (agentKey.provider !== "openai") return null;
  if (!isBase64UrlBytes(agentKey.iv, 12) || !isBase64UrlBytes(agentKey.tag, 16)) return null;
  if (!isBase64UrlBytes(agentKey.ciphertext, null, 20, 512)) return null;
  if (typeof agentKey.keyHint !== "string" || !/^[\x21-\x7e]{4}$/.test(agentKey.keyHint)) {
    return null;
  }
  if (typeof agentKey.updatedAt !== "string" || !Number.isFinite(Date.parse(agentKey.updatedAt))) {
    return null;
  }

  return {
    algorithm: agentKey.algorithm,
    ciphertext: agentKey.ciphertext,
    iv: agentKey.iv,
    keyHint: agentKey.keyHint,
    provider: agentKey.provider,
    tag: agentKey.tag,
    updatedAt: agentKey.updatedAt,
    version: agentKey.version,
  };
}

function isBase64UrlBytes(value, exactLength, minLength = exactLength, maxLength = exactLength) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return false;

  const bytes = Buffer.from(value, "base64url");
  if (exactLength !== null) return bytes.length === exactLength;
  return bytes.length >= minLength && bytes.length <= maxLength;
}

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function googleAuthEnabled() {
  return Boolean(config.googleClientId && config.googleClientSecret);
}

function googleRedirectUri(request) {
  if (config.googleRedirectUri) return config.googleRedirectUri;
  return `${config.publicBaseUrl || requestBaseUrl(request)}/api/auth/google/callback`;
}

function createOAuthState(next) {
  return {
    codeVerifier: randomToken(),
    issuedAt: Date.now(),
    next,
    nonce: randomToken(),
    state: randomToken(),
  };
}

function oauthStateCookie(oauthState) {
  const payload = Buffer.from(JSON.stringify(oauthState)).toString("base64url");
  return cookie(
    config.oauthCookieName,
    `${payload}.${hashToken(`oauth:${payload}`)}`,
    10 * 60,
    "/api/auth/google",
  );
}

function expiredOAuthStateCookie() {
  return cookie(config.oauthCookieName, "", 0, "/api/auth/google");
}

function readOAuthState(request) {
  const raw = parseCookies(request.headers.cookie || "")[config.oauthCookieName];
  if (!raw) return null;

  const [payload, signature, ...extra] = raw.split(".");
  if (!payload || !signature || extra.length) return null;
  if (!safeEqual(signature, hashToken(`oauth:${payload}`))) return null;

  let oauthState;
  try {
    oauthState = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!oauthState || typeof oauthState !== "object") return null;
  if (!Number.isFinite(oauthState.issuedAt) || oauthState.issuedAt + 10 * 60 * 1000 < Date.now()) {
    return null;
  }
  if (!isOAuthToken(oauthState.state) || !isOAuthToken(oauthState.nonce)) return null;
  if (!isOAuthToken(oauthState.codeVerifier)) return null;

  return {
    ...oauthState,
    next: normalizeReturnPath(oauthState.next),
  };
}

function isOAuthToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,160}$/.test(value);
}

function normalizeReturnPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";

  try {
    const url = new URL(value, "http://localhost");
    if (url.origin !== "http://localhost") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

function sha256Base64Url(value) {
  return crypto.createHash("sha256").update(String(value)).digest("base64url");
}

async function exchangeGoogleCode(code, codeVerifier, request) {
  if (typeof code !== "string" || !code || code.length > 4096) {
    throw new Error("Google nije vratio ispravan autorizacijski kod.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: googleRedirectUri(request),
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Google token endpoint vratio je HTTP ${response.status}.`);
  }

  const token = await response.json();
  if (!token || typeof token.id_token !== "string") {
    throw new Error("Google nije vratio ID token.");
  }
  return token;
}

function readGoogleProfile(idToken, expectedNonce) {
  const parts = String(idToken).split(".");
  if (parts.length !== 3) throw new Error("Google ID token nije ispravan.");

  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("Google ID token nije ispravan.");
  }

  // The token is returned directly by Google's HTTPS token endpoint during this request.
  const issuerIsValid =
    claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const email = String(claims.email || "").trim().toLowerCase();
  if (!issuerIsValid) throw new Error("Google ID token ima neispravnog izdavatelja.");
  if (!audience.includes(config.googleClientId)) throw new Error("Google ID token nije namijenjen ovoj aplikaciji.");
  if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) {
    throw new Error("Google ID token je istekao.");
  }
  if (!safeEqual(claims.nonce, expectedNonce)) throw new Error("Google ID token ima neispravan nonce.");
  if (typeof claims.sub !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(claims.sub)) {
    throw new Error("Google račun nema ispravan identifikator.");
  }
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || ![true, "true"].includes(claims.email_verified)) {
    throw new Error("Google račun nema potvrđenu e-mail adresu.");
  }

  return {
    displayName: String(claims.name || email).trim().slice(0, 200),
    email,
    googleSubject: claims.sub,
  };
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
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

function sessionCookie(token, ttlMs) {
  return cookie(config.cookieName, token, Math.floor(ttlMs / 1000), "/");
}

function expiredSessionCookie() {
  return cookie(config.cookieName, "", 0, "/");
}

function cookie(name, value, maxAgeSeconds, cookiePath) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${cookiePath}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (config.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

function redirect(response, location, headers = {}) {
  response.writeHead(302, {
    "Cache-Control": "no-store",
    Location: location,
    ...headers,
  });
  response.end();
}

function redirectToLogin(response, error, cookieHeader, next) {
  const params = new URLSearchParams({ auth_error: error });
  if (next && next !== "/") params.set("next", normalizeReturnPath(next));
  redirect(response, `/prijava.html?${params}`, {
    "Set-Cookie": cookieHeader,
  });
}

async function initializeDatabase() {
  await fsp.mkdir(path.dirname(config.databaseFile), { recursive: true });
  database = new DatabaseSync(config.databaseFile);
  database.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS app_meta (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      auth_provider TEXT NOT NULL,
      created_at TEXT NOT NULL,
      display_name TEXT NOT NULL,
      email TEXT NOT NULL,
      email_verified INTEGER NOT NULL,
      google_subject TEXT NOT NULL UNIQUE,
      last_login_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      user_agent TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_token_hash_index ON sessions(token_hash);

    CREATE TABLE IF NOT EXISTS simulation_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      submitted_at TEXT NOT NULL,
      solver TEXT NOT NULL,
      subject TEXT NOT NULL,
      part TEXT NOT NULL,
      exam_id TEXT NOT NULL,
      year INTEGER,
      term TEXT NOT NULL,
      level TEXT NOT NULL,
      school_year TEXT NOT NULL,
      duration_minutes REAL,
      answered REAL,
      total_questions REAL,
      score REAL,
      max_score REAL,
      percentage REAL,
      checking_supported INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS simulation_attempts_user_index
      ON simulation_attempts(user_id, submitted_at DESC);

    CREATE TABLE IF NOT EXISTS agent_keys (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      version INTEGER NOT NULL,
      algorithm TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      tag TEXT NOT NULL,
      key_hint TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function loadStore() {
  const users = {};
  for (const row of database.prepare("SELECT * FROM users").all()) {
    users[row.id] = {
      authProvider: row.auth_provider,
      createdAt: row.created_at,
      displayName: row.display_name,
      email: row.email,
      emailVerified: row.email_verified === 1,
      googleSubject: row.google_subject,
      id: row.id,
      lastLoginAt: row.last_login_at,
      simulationAttempts: [],
      updatedAt: row.updated_at,
    };
  }

  for (const row of database.prepare("SELECT * FROM agent_keys").all()) {
    const user = users[row.user_id];
    if (!user) continue;
    user.agentKey =
      normalizeEncryptedAgentKey({
        algorithm: row.algorithm,
        ciphertext: row.ciphertext,
        iv: row.iv,
        keyHint: row.key_hint,
        provider: row.provider,
        tag: row.tag,
        updatedAt: row.updated_at,
        version: row.version,
      }) || undefined;
  }

  for (const row of database.prepare("SELECT * FROM simulation_attempts ORDER BY submitted_at DESC").all()) {
    const user = users[row.user_id];
    if (!user) continue;
    const attempt = normalizeSimulationAttempt({
      answered: row.answered,
      checkingSupported: row.checking_supported === 1,
      durationMinutes: row.duration_minutes,
      examId: row.exam_id,
      id: row.id,
      level: row.level,
      maxScore: row.max_score,
      part: row.part,
      percentage: row.percentage,
      schoolYear: row.school_year,
      score: row.score,
      solver: row.solver,
      subject: row.subject,
      submittedAt: row.submitted_at,
      term: row.term,
      totalQuestions: row.total_questions,
      year: row.year,
    });
    if (attempt) user.simulationAttempts.push(attempt);
  }

  const sessions = {};
  for (const row of database.prepare("SELECT * FROM sessions").all()) {
    if (!users[row.user_id]) continue;
    sessions[row.id] = {
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      id: row.id,
      ipAddress: row.ip_address,
      lastSeenAt: row.last_seen_at,
      tokenHash: row.token_hash,
      userAgent: row.user_agent,
      userId: row.user_id,
    };
  }

  return { sessions, users };
}

async function migrateLegacyStore() {
  const alreadyMigrated = database
    .prepare("SELECT value FROM app_meta WHERE name = ?")
    .get("legacy_json_migrated");
  if (alreadyMigrated) return;

  if (!Object.keys(store.users).length) {
    const legacyStore = await loadLegacyStore();
    if (legacyStore) {
      store = legacyStore;
      pruneExpiredRecords();
      await persistStore();
      console.log(`Migriran stari auth store: ${config.legacyStoreFile}`);
    }
  }

  database
    .prepare(
      "INSERT INTO app_meta (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
    )
    .run("legacy_json_migrated", new Date().toISOString());
}

async function loadLegacyStore() {
  try {
    const raw = await fsp.readFile(config.legacyStoreFile, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function normalizeStore(parsed) {
  const users = {};
  for (const [id, user] of Object.entries(parsed?.users || {})) {
    if (!user || user.authProvider !== "google" || typeof user.googleSubject !== "string") continue;
    users[id] = {
      authProvider: "google",
      agentKey: normalizeEncryptedAgentKey(user.agentKey) || undefined,
      createdAt: user.createdAt,
      displayName: user.displayName,
      email: user.email,
      emailVerified: true,
      googleSubject: user.googleSubject,
      id,
      lastLoginAt: user.lastLoginAt,
      simulationAttempts: Array.isArray(user.simulationAttempts)
        ? user.simulationAttempts.map(normalizeSimulationAttempt).filter(Boolean).slice(0, 200)
        : [],
      updatedAt: user.updatedAt,
    };
  }

  const sessions = {};
  for (const [id, session] of Object.entries(parsed?.sessions || {})) {
    if (!session || !users[session.userId]) continue;
    sessions[id] = session;
  }

  return { sessions, users };
}

function persistStore() {
  const insertUser = database.prepare(`
    INSERT INTO users (
      id, auth_provider, created_at, display_name, email, email_verified,
      google_subject, last_login_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSession = database.prepare(`
    INSERT INTO sessions (
      id, user_id, created_at, expires_at, ip_address, last_seen_at, token_hash, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSimulation = database.prepare(`
    INSERT INTO simulation_attempts (
      id, user_id, submitted_at, solver, subject, part, exam_id, year, term, level,
      school_year, duration_minutes, answered, total_questions, score, max_score,
      percentage, checking_supported
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAgentKey = database.prepare(`
    INSERT INTO agent_keys (
      user_id, provider, version, algorithm, ciphertext, iv, tag, key_hint, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      DELETE FROM simulation_attempts;
      DELETE FROM agent_keys;
      DELETE FROM sessions;
      DELETE FROM users;
    `);

    for (const user of Object.values(store.users)) {
      insertUser.run(
        user.id,
        user.authProvider,
        user.createdAt,
        user.displayName,
        user.email,
        user.emailVerified ? 1 : 0,
        user.googleSubject,
        sqlValue(user.lastLoginAt),
        user.updatedAt,
      );

      const agentKey = normalizeEncryptedAgentKey(user.agentKey);
      if (agentKey) {
        insertAgentKey.run(
          user.id,
          agentKey.provider,
          agentKey.version,
          agentKey.algorithm,
          agentKey.ciphertext,
          agentKey.iv,
          agentKey.tag,
          agentKey.keyHint,
          agentKey.updatedAt,
        );
      }

      for (const attempt of (user.simulationAttempts || []).slice(0, 200)) {
        insertSimulation.run(
          attempt.id,
          user.id,
          attempt.submittedAt,
          attempt.solver,
          attempt.subject,
          attempt.part,
          attempt.examId,
          sqlValue(attempt.year),
          attempt.term,
          attempt.level,
          attempt.schoolYear,
          sqlValue(attempt.durationMinutes),
          sqlValue(attempt.answered),
          sqlValue(attempt.totalQuestions),
          sqlValue(attempt.score),
          sqlValue(attempt.maxScore),
          sqlValue(attempt.percentage),
          attempt.checkingSupported === false ? 0 : 1,
        );
      }
    }

    for (const session of Object.values(store.sessions)) {
      if (!store.users[session.userId]) continue;
      insertSession.run(
        session.id,
        session.userId,
        session.createdAt,
        session.expiresAt,
        session.ipAddress,
        session.lastSeenAt,
        session.tokenHash,
        session.userAgent,
      );
    }

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function sqlValue(value) {
  return value === undefined ? null : value;
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
    "/abcd-choice.js",
    "/abcd.html",
    "/app.js",
    "/asistent_za_maturu.png",
    "/auth-client.js",
    "/croatian-choice.js",
    "/english-reading.html",
    "/english-essay.js",
    "/english-reading.js",
    "/english-listening.js",
    "/engleski-citanje.html",
    "/engleski-esej.html",
    "/engleski-slusanje.html",
    "/exam-simulation.js",
    "/fizika-abcd.html",
    "/fizika.html",
    "/hrvatski.html",
    "/index.html",
    "/matematika.html",
    "/math-choice.js",
    "/physics-choice.js",
    "/prijava.html",
    "/profil.html",
    "/profile-page.js",
    "/profile-store.js",
    "/site-footer.js",
    "/site-header.js",
    "/solver-header.js",
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
