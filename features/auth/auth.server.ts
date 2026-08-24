/**
 * Server-side authentication.
 *
 * Token-based flow: verify endpoint validates PIN/password, issues short-lived JWT.
 * App stores JWT in an httpOnly cookie by default; API routes also accept
 * Authorization: Bearer <token> for explicit callers (CLI/tools).
 *
 * Config-driven. Every comparison is timing-safe, every verify endpoint is rate-limited.
 * Cron uses Bearer secret directly (no verify flow).
 *
 * Env: AUTH_SECRET (JWT signing), ADMIN_PASSWORD, UPLOAD_PIN, CRON_SECRET
 */

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { isIP } from "node:net";
import { getRequestIP } from "@tanstack/react-start/server";
import { getCookie } from "@/lib/http/cookies";
import { getRedis } from "@/lib/platform/redis.server";
import {
  getAuthCookieName,
  LOCAL_DEV_ADMIN_COOKIE,
  LOCAL_DEV_ADMIN_COOKIE_MAX_AGE_SECONDS,
} from "./cookies";
import { authenticateUploadAccess } from "./upload-access.server";

/* ─── Types ─── */

type VerifyConfig = {
  bodyField: string;
  sanitize?: (value: string) => string;
};

type RoleConfig = {
  envVar: string;
  verify?: VerifyConfig;
};

type AuthRole = "admin" | "upload" | "cron";
type TokenRole = Exclude<AuthRole, "cron">;
type RevocableRole = Exclude<AuthRole, "cron">;

const ROLES: Record<AuthRole, RoleConfig> = {
  admin: {
    envVar: "ADMIN_PASSWORD",
    verify: { bodyField: "password", sanitize: (v) => v.trim() },
  },
  upload: {
    envVar: "UPLOAD_PIN",
    verify: { bodyField: "pin" },
  },
  cron: { envVar: "CRON_SECRET" },
};

const TOKEN_ROLES: TokenRole[] = ["admin", "upload"];
const REVOCABLE_ROLES: readonly RevocableRole[] = ["admin", "upload"];
const TOKEN_EXPIRY_SECONDS_BY_ROLE: Record<TokenRole, number> = {
  admin: 60 * 60, // 1h
  upload: 12 * 60 * 60, // 12h
};
const ADMIN_STEP_UP_TTL_SECONDS = 5 * 60;
const LOGIN_DEDUPE_WINDOW_SECONDS = 15;
const MIN_AUTH_SECRET_LENGTH = 32;
const MIN_ADMIN_PASSWORD_LENGTH = 12;
const MIN_UPLOAD_PIN_LENGTH = 12;
const WEAK_SECRET_VALUES = new Set([
  "password",
  "password123",
  "admin",
  "admin123",
  "changeme",
  "letmein",
  "123456",
  "qwerty",
]);

function isLocalDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

// This value only exists in a local development server process. A random value
// keeps the convenience cookie scoped to the process that issued it.
const LOCAL_DEV_ADMIN_COOKIE_VALUE = isLocalDevelopment() ? randomBytes(32).toString("hex") : null;

function getLocalDevAdminCookieValue(): string | null {
  return LOCAL_DEV_ADMIN_COOKIE_VALUE;
}

function isLocalDevAdminRequest(request: Request): boolean {
  const value = getCookie(request, LOCAL_DEV_ADMIN_COOKIE);
  const expected = getLocalDevAdminCookieValue();
  return Boolean(value && expected && safeCompare(value, expected));
}

function getLocalDevAdminPayload(): TokenPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    role: "admin",
    iat: now,
    exp: now + LOCAL_DEV_ADMIN_COOKIE_MAX_AGE_SECONDS,
    jti: "local-dev-admin",
    tv: 1,
  };
}

function getLocalDevAdminAuth(request: Request): {
  token: string;
  payload: TokenPayload;
} | null {
  if (!isLocalDevelopment() || !isLocalDevAdminRequest(request)) return null;
  const token = getLocalDevAdminCookieValue();
  if (!token) return null;
  return { token, payload: getLocalDevAdminPayload() };
}

function tokenVersionKey(role: RevocableRole): string {
  return `auth:token-version:${role}`;
}

function loginDedupeKey(role: TokenRole, ip: string, ua: string): string {
  const fingerprint = createHash("sha256")
    .update(`${role}|${ip || "unknown"}|${ua || "unknown"}`)
    .digest("hex")
    .slice(0, 24);
  return `auth:recent-login:${role}:${fingerprint}`;
}

/* ─── JWT (HS256, no deps) ─── */

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64UrlDecode(str: string): Buffer {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  return Buffer.from(padded, "base64");
}

function getRawEnv(name: string): string | null {
  const raw = process.env[name];
  if (!raw) return null;
  return raw.trim() || null;
}

function validateSecretStrength(label: string, value: string, minLength: number): string | null {
  if (value.length < minLength) {
    return `${label} is too weak (minimum ${minLength} characters required)`;
  }
  if (WEAK_SECRET_VALUES.has(value.toLowerCase())) {
    return `${label} is too weak (common secret value)`;
  }
  return null;
}

function getAuthSecretStatus(): { secret: string | null; error: string | null } {
  const secret = getRawEnv("AUTH_SECRET");
  if (!secret) {
    return { secret: null, error: "AUTH_SECRET not configured" };
  }
  const weakness = validateSecretStrength("AUTH_SECRET", secret, MIN_AUTH_SECRET_LENGTH);
  if (weakness) {
    return { secret: null, error: weakness };
  }
  return { secret, error: null };
}

function getRoleSecretStatus(role: AuthRole): { secret: string | null; error: string | null } {
  const envVar = ROLES[role].envVar;
  const secret = getRawEnv(envVar);
  if (!secret) {
    return { secret: null, error: `${envVar} not configured` };
  }
  const minimum =
    role === "admin" ? MIN_ADMIN_PASSWORD_LENGTH : role === "upload" ? MIN_UPLOAD_PIN_LENGTH : 0;
  if (minimum > 0) {
    const weakness = validateSecretStrength(envVar, secret, minimum);
    if (weakness) return { secret: null, error: weakness };
  }
  return { secret, error: null };
}

async function getCurrentTokenVersion(role: RevocableRole): Promise<number | null> {
  const redis = getRedis();
  if (!redis) {
    return process.env.NODE_ENV === "production" ? null : 1;
  }

  const key = tokenVersionKey(role);
  try {
    const current = await redis.get<number>(key);
    if (typeof current === "number" && Number.isFinite(current) && current >= 1) {
      return Math.floor(current);
    }
    await redis.set(key, 1);
    return 1;
  } catch {
    return process.env.NODE_ENV === "production" ? null : 1;
  }
}

/** Sign a JWT for the given role. Payload: { role, exp, iat, jti, tv }. */
function generateTokenJti(): string {
  // Include UUID + random bytes + timestamp so test/runtime entropy differences
  // cannot accidentally produce the same session id.
  return `${Date.now().toString(36)}-${randomUUID()}-${randomBytes(6).toString("hex")}`;
}

function isValidTokenJti(value: string): boolean {
  return value.length <= 128 && /^[a-z0-9]+-[0-9a-f-]{36}-[0-9a-f]{12}$/i.test(value);
}

async function signToken(role: TokenRole): Promise<string | null> {
  const { secret } = getAuthSecretStatus();
  if (!secret) return null;
  const tokenVersion = await getCurrentTokenVersion(role);
  if (!tokenVersion) return null;

  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    role,
    iat: now,
    exp: now + TOKEN_EXPIRY_SECONDS_BY_ROLE[role],
    jti: generateTokenJti(),
    tv: tokenVersion,
  };

  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const message = `${headerB64}.${payloadB64}`;

  const sig = createHmac("sha256", secret).update(message).digest();
  const sigB64 = base64UrlEncode(sig);

  return `${message}.${sigB64}`;
}

type TokenSessionSource = "browser" | "cli";

async function registerTokenSession(
  token: string,
  metadata: { ip: string; ua: string; source: TokenSessionSource },
  dedupeKey?: string,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return process.env.NODE_ENV !== "production";

  try {
    const issuedAt = Math.floor(Date.now() / 1000);
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(base64UrlDecode(parts[1]).toString()) as TokenPayload;
    const ttlSeconds = Math.max(1, payload.exp - issuedAt);
    await redis.set(`auth:session:${payload.jti}`, {
      role: payload.role,
      iat: payload.iat,
      exp: payload.exp,
      tv: payload.tv,
      ip: metadata.ip,
      ua: metadata.ua,
      source: metadata.source,
    });
    await redis.expire(`auth:session:${payload.jti}`, ttlSeconds + 60);
    await redis.sadd("auth:sessions:index", payload.jti);
    await redis.expire("auth:sessions:index", 60 * 60 * 24 * 60);
    if (dedupeKey) {
      await redis.set(dedupeKey, token);
      await redis.expire(dedupeKey, LOGIN_DEDUPE_WINDOW_SECONDS);
    }
    return true;
  } catch {
    return false;
  }
}

export async function issueAdminTokenForCli(metadata: {
  ip: string;
  ua: string;
}): Promise<string | null> {
  const token = await signToken("admin");
  if (!token) return null;
  return (await registerTokenSession(token, { ...metadata, source: "cli" })) ? token : null;
}

type TokenPayload = { role: TokenRole; exp: number; iat: number; jti: string; tv: number };
type StepUpPayload = {
  kind: "admin-step-up";
  parentJti: string;
  iat: number;
  exp: number;
  nonce: string;
};

async function getOpenUploadAuth(
  request: Request,
): Promise<{ token: string; payload: TokenPayload } | null> {
  const session = await authenticateUploadAccess(request);
  if (!session) return null;
  return {
    token: session.token,
    payload: {
      role: "upload",
      iat: Math.floor(Date.parse(session.window.openedAt) / 1000),
      exp: Math.floor(Date.parse(session.window.expiresAt) / 1000),
      jti: `upload-open-${session.window.id}`,
      tv: 0,
    },
  };
}

/** Verify JWT and return payload if valid for the expected role. */
async function verifyToken(token: string, expectedRole: TokenRole): Promise<TokenPayload | null> {
  const { secret } = getAuthSecretStatus();
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  const message = `${headerB64}.${payloadB64}`;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString()) as TokenPayload;
  } catch {
    return null;
  }

  if (payload.role !== expectedRole) return null;
  if (!payload.jti || typeof payload.jti !== "string") return null;
  if (!Number.isInteger(payload.tv) || payload.tv < 1) return null;
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  const expectedSig = createHmac("sha256", secret).update(message).digest();
  const actualSig = base64UrlDecode(sigB64);
  if (actualSig.length !== expectedSig.length || !timingSafeEqual(actualSig, expectedSig)) {
    return null;
  }

  const redis = getRedis();
  if (redis) {
    try {
      const revoked = await redis.exists(`auth:revoked-jti:${payload.jti}`);
      if (revoked) return null;
    } catch {
      if (process.env.NODE_ENV === "production") {
        return null;
      }
    }
  }

  const currentVersion = await getCurrentTokenVersion(expectedRole);
  if (!currentVersion || payload.tv !== currentVersion) return null;

  return payload;
}

async function verifyTokenForRoles(
  token: string,
  acceptedRoles: readonly TokenRole[],
): Promise<TokenPayload | null> {
  for (const role of acceptedRoles) {
    const payload = await verifyToken(token, role);
    if (payload) return payload;
  }
  return null;
}

/* ─── Primitives ─── */

/** Timing-safe equality. Returns false if lengths differ. */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Resolve the peer address supplied by the Nitro/H3 request context. */
function getClientIp(_request: Request): string {
  // Resolve the peer address from the Nitro/H3 request context. Do not trust
  // client-controlled forwarding headers in application code.
  try {
    const ip = getRequestIP();
    return typeof ip === "string" && isIP(ip) ? ip : "unknown";
  } catch {
    return "unknown";
  }
}

function extractBearer(request: Request): string {
  const raw = request.headers.get("authorization") ?? "";
  return raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
}

function extractTokenFromCookies(request: Request, role: TokenRole): string {
  return getCookie(request, getAuthCookieName(role));
}

function extractAuthTokenForAcceptedRoles(
  request: Request,
  acceptedRoles: readonly TokenRole[],
): string {
  const bearer = extractBearer(request);
  if (bearer) return bearer;
  for (const role of acceptedRoles) {
    const cookieToken = extractTokenFromCookies(request, role);
    if (cookieToken) return cookieToken;
  }
  return "";
}

/* ─── Rate limiting ─── */

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 900;
const memoryRateLimit = new Map<string, { attempts: number; resetAtMs: number }>();

const RESERVE_RATE_LIMIT_SCRIPT = `
local identity = redis.call("INCR", KEYS[1])
if identity == 1 then redis.call("EXPIRE", KEYS[1], ARGV[3]) end
local global = redis.call("INCR", KEYS[2])
if global == 1 then redis.call("EXPIRE", KEYS[2], ARGV[3]) end
local allowed = 1
if identity > tonumber(ARGV[1]) or global > tonumber(ARGV[2]) then allowed = 0 end
local remaining = tonumber(ARGV[1]) - identity
if remaining < 0 then remaining = 0 end
local retry = redis.call("TTL", KEYS[1])
return { allowed, remaining, retry }
`;

const RESERVE_STEP_UP_SCRIPT = `
local attempts = redis.call("INCR", KEYS[1])
if attempts == 1 then redis.call("EXPIRE", KEYS[1], ARGV[2]) end
local allowed = attempts <= tonumber(ARGV[1]) and 1 or 0
local remaining = tonumber(ARGV[1]) - attempts
if remaining < 0 then remaining = 0 end
local retry = redis.call("TTL", KEYS[1])
return { allowed, remaining, retry }
`;

function memoryKey(role: AuthRole, ip: string): string {
  return `mem:${role}:${ip}`;
}

async function checkRateLimit(
  role: AuthRole,
  ip: string,
): Promise<{ allowed: boolean; remaining: number; backendAvailable: boolean }> {
  const redis = getRedis();
  if (!redis) {
    if (process.env.NODE_ENV === "production") {
      return { allowed: false, remaining: 0, backendAvailable: false };
    }
    // In-memory fallback: good enough for local dev and prevents accidental brute force.
    const key = memoryKey(role, ip);
    const now = Date.now();
    const entry = memoryRateLimit.get(key);
    const fresh =
      !entry || entry.resetAtMs <= now
        ? { attempts: 0, resetAtMs: now + LOCKOUT_SECONDS * 1000 }
        : entry;
    fresh.attempts += 1;
    memoryRateLimit.set(key, fresh);

    if (fresh.attempts > MAX_ATTEMPTS) {
      return { allowed: false, remaining: 0, backendAvailable: false };
    }
    return {
      allowed: true,
      remaining: Math.max(0, MAX_ATTEMPTS - fresh.attempts),
      backendAvailable: false,
    };
  }

  const key = `auth:ratelimit:${role}:${ip}`;
  const globalKey = `auth:ratelimit:${role}:global`;
  try {
    const result = (await redis.eval<number[]>(
      RESERVE_RATE_LIMIT_SCRIPT,
      [key, globalKey],
      [MAX_ATTEMPTS, MAX_ATTEMPTS * 20, LOCKOUT_SECONDS],
    )) as number[];
    return {
      allowed: Number(result?.[0]) === 1,
      remaining: Math.max(0, Number(result?.[1]) || 0),
      backendAvailable: true,
    };
  } catch {
    return { allowed: false, remaining: 0, backendAvailable: false };
  }
}

async function clearRateLimit(role: AuthRole, ip: string): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    memoryRateLimit.delete(memoryKey(role, ip));
    return;
  }
  await redis.del(`auth:ratelimit:${role}:${ip}`);
}

function stepUpRateLimitKey(parentJti: string): string {
  return `auth:step-up-ratelimit:${parentJti}`;
}

async function reserveStepUpAttempt(
  parentJti: string,
): Promise<{ allowed: boolean; remaining: number; backendAvailable: boolean }> {
  const redis = getRedis();
  const key = stepUpRateLimitKey(parentJti);
  if (!redis) {
    if (process.env.NODE_ENV === "production") {
      return { allowed: false, remaining: 0, backendAvailable: false };
    }
    const entry = memoryRateLimit.get(`mem:${key}`);
    const now = Date.now();
    const fresh =
      !entry || entry.resetAtMs <= now
        ? { attempts: 0, resetAtMs: now + LOCKOUT_SECONDS * 1000 }
        : entry;
    fresh.attempts += 1;
    memoryRateLimit.set(`mem:${key}`, fresh);
    return {
      allowed: fresh.attempts <= MAX_ATTEMPTS,
      remaining: Math.max(0, MAX_ATTEMPTS - fresh.attempts),
      backendAvailable: false,
    };
  }
  try {
    const result = (await redis.eval<number[]>(
      RESERVE_STEP_UP_SCRIPT,
      [key],
      [MAX_ATTEMPTS, LOCKOUT_SECONDS],
    )) as number[];
    return {
      allowed: Number(result?.[0]) === 1,
      remaining: Math.max(0, Number(result?.[1]) || 0),
      backendAvailable: true,
    };
  } catch {
    return { allowed: false, remaining: 0, backendAvailable: false };
  }
}

async function clearStepUpFailures(parentJti: string): Promise<void> {
  const redis = getRedis();
  const key = stepUpRateLimitKey(parentJti);
  if (!redis) {
    memoryRateLimit.delete(`mem:${key}`);
    return;
  }
  await redis.del(key);
}

/* ─── Route guard ─── */

/**
 * Protect an API route. Returns null when authorized, or an error response.
 *
 * For admin/upload: Validates JWT (Authorization: Bearer <token>).
 * For cron: Validates Bearer secret directly.
 */
async function requireAuth(request: Request, role: AuthRole): Promise<Response | null> {
  if (role === "cron") {
    const { secret, error } = getRoleSecretStatus("cron");
    if (!secret) {
      return Response.json({ error: error ?? "CRON_SECRET not configured" }, { status: 503 });
    }
    const candidate = extractBearer(request);
    if (!candidate || !safeCompare(candidate, secret)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return null;
  }

  if (role === "admin" || role === "upload") {
    if (getLocalDevAdminAuth(request)) return null;
  }

  const acceptedRoles = role === "upload" ? (["admin", "upload"] as const) : ([role] as const);

  const token = extractAuthTokenForAcceptedRoles(request, acceptedRoles);
  if (!token) {
    if (role === "upload" && (await getOpenUploadAuth(request))) return null;
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await verifyTokenForRoles(token, acceptedRoles);
  if (!payload) {
    if (role === "upload" && (await getOpenUploadAuth(request))) return null;
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

/**
 * Like `requireAuth`, but returns the decoded token payload (when applicable).
 * Useful when follow-up auth steps need the token's `jti` (e.g. admin step-up).
 */
async function requireAuthWithPayload(
  request: Request,
  role: AuthRole,
): Promise<{ error: Response | null; payload: TokenPayload | null }> {
  if (role === "cron") {
    const error = await requireAuth(request, "cron");
    return { error, payload: null };
  }

  if (role === "admin" || role === "upload") {
    const localAuth = getLocalDevAdminAuth(request);
    if (localAuth) return { error: null, payload: localAuth.payload };
  }

  const acceptedRoles = role === "upload" ? (["admin", "upload"] as const) : ([role] as const);

  const token = extractAuthTokenForAcceptedRoles(request, acceptedRoles);
  if (!token) {
    const openAuth = role === "upload" ? await getOpenUploadAuth(request) : null;
    if (openAuth) return { error: null, payload: openAuth.payload };
    return {
      error: Response.json({ error: "Unauthorized" }, { status: 401 }),
      payload: null,
    };
  }

  const payload = await verifyTokenForRoles(token, acceptedRoles);
  if (!payload) {
    const openAuth = role === "upload" ? await getOpenUploadAuth(request) : null;
    if (openAuth) return { error: null, payload: openAuth.payload };
    return {
      error: Response.json({ error: "Unauthorized" }, { status: 401 }),
      payload: null,
    };
  }
  return { error: null, payload };
}

function signStepUpToken(parentJti: string): string | null {
  const { secret } = getAuthSecretStatus();
  if (!secret) return null;
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload: StepUpPayload = {
    kind: "admin-step-up",
    parentJti,
    iat: now,
    exp: now + ADMIN_STEP_UP_TTL_SECONDS,
    nonce: randomUUID(),
  };

  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const message = `${headerB64}.${payloadB64}`;
  const sig = createHmac("sha256", secret).update(message).digest();
  return `${message}.${base64UrlEncode(sig)}`;
}

function verifyStepUpToken(token: string, parentJti: string): boolean {
  const { secret } = getAuthSecretStatus();
  if (!secret) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, sigB64] = parts;
  const message = `${headerB64}.${payloadB64}`;

  let payload: StepUpPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString()) as StepUpPayload;
  } catch {
    return false;
  }

  if (payload.kind !== "admin-step-up") return false;
  if (payload.parentJti !== parentJti) return false;
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const expectedSig = createHmac("sha256", secret).update(message).digest();
  const actualSig = base64UrlDecode(sigB64);
  return actualSig.length === expectedSig.length && timingSafeEqual(actualSig, expectedSig);
}

/**
 * Enforces "step-up" for destructive admin actions.
 * Requires `x-admin-step-up` header containing a short-lived token bound to the
 * caller's admin session `jti`.
 */
async function requireAdminStepUp(request: Request): Promise<Response | null> {
  const { error, payload } = await requireAuthWithPayload(request, "admin");
  if (error || !payload) return error;

  if (getLocalDevAdminAuth(request)) return null;

  const stepUpToken = request.headers.get("x-admin-step-up")?.trim() ?? "";
  if (!stepUpToken) {
    return Response.json(
      { error: "Step-up verification required", code: "STEP_UP_REQUIRED" },
      { status: 428 },
    );
  }
  if (!verifyStepUpToken(stepUpToken, payload.jti)) {
    return Response.json(
      { error: "Invalid or expired step-up token", code: "STEP_UP_INVALID" },
      { status: 401 },
    );
  }
  return null;
}

/**
 * Issues an admin step-up token after re-checking the admin password.
 * Designed for `/api/admin/step-up` and consumed via `x-admin-step-up`.
 */
async function createAdminStepUpToken(request: Request, password: string): Promise<Response> {
  const { error, payload } = await requireAuthWithPayload(request, "admin");
  if (error || !payload) {
    return error ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const reservation = await reserveStepUpAttempt(payload.jti);
  if (!reservation.backendAvailable && process.env.NODE_ENV === "production") {
    return Response.json(
      { error: "Step-up verification is temporarily unavailable." },
      { status: 503 },
    );
  }
  if (!reservation.allowed) {
    return Response.json(
      { error: "Too many step-up attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(LOCKOUT_SECONDS) } },
    );
  }

  const adminSecretStatus = getRoleSecretStatus("admin");
  if (!adminSecretStatus.secret) {
    return Response.json(
      { error: adminSecretStatus.error ?? "ADMIN_PASSWORD not configured" },
      { status: 503 },
    );
  }
  if (!safeCompare(password.trim(), adminSecretStatus.secret)) {
    return Response.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = signStepUpToken(payload.jti);
  if (!token) {
    return Response.json({ error: "Failed to create step-up token" }, { status: 503 });
  }
  await clearStepUpFailures(payload.jti);
  return Response.json({
    ok: true,
    token,
    expiresInSeconds: ADMIN_STEP_UP_TTL_SECONDS,
  });
}

/**
 * Revokes all existing tokens for a role by bumping its token version.
 * Requires Redis (fails closed if not configured).
 */
async function revokeRoleTokens(
  role: RevocableRole,
): Promise<{ role: RevocableRole; tokenVersion: number }> {
  const redis = getRedis();
  if (!redis) {
    throw new Error("Redis not configured");
  }

  const key = tokenVersionKey(role);
  const next = await redis.incr(key);
  const tokenVersion = next > 0 ? next : 1;
  if (next <= 0) {
    await redis.set(key, tokenVersion);
  }
  return { role, tokenVersion };
}

/** Convenience helper to revoke tokens for all revocable roles. */
async function revokeAllRoleTokens(): Promise<
  Array<{ role: RevocableRole; tokenVersion: number }>
> {
  const results: Array<{ role: RevocableRole; tokenVersion: number }> = [];
  for (const role of REVOCABLE_ROLES) {
    results.push(await revokeRoleTokens(role));
  }
  return results;
}

/** Human-readable environment warnings for admin/debug surfaces. */
function getSecurityWarnings(): string[] {
  const warnings: string[] = [];
  const authSecret = getRawEnv("AUTH_SECRET");
  if (!authSecret) {
    warnings.push("AUTH_SECRET missing");
  } else {
    const issue = validateSecretStrength("AUTH_SECRET", authSecret, MIN_AUTH_SECRET_LENGTH);
    if (issue) warnings.push(issue);
  }

  const adminPassword = getRawEnv("ADMIN_PASSWORD");
  if (!adminPassword) {
    warnings.push("ADMIN_PASSWORD missing");
  } else {
    const issue = validateSecretStrength(
      "ADMIN_PASSWORD",
      adminPassword,
      MIN_ADMIN_PASSWORD_LENGTH,
    );
    if (issue) warnings.push(issue);
  }

  const uploadPin = getRawEnv("UPLOAD_PIN");
  if (!uploadPin) warnings.push("UPLOAD_PIN missing");
  else {
    const issue = validateSecretStrength("UPLOAD_PIN", uploadPin, MIN_UPLOAD_PIN_LENGTH);
    if (issue) warnings.push(issue);
  }

  return warnings;
}

/* ─── Verify handler ─── */

/**
 * Handle a POST verify endpoint. On success, issues a JWT token.
 * App stores JWT in an httpOnly cookie by default; API routes also accept
 * Authorization: Bearer <token>.
 */
async function handleVerifyRequest(request: Request, role: AuthRole): Promise<Response> {
  const config = ROLES[role];

  if (!config.verify) {
    return Response.json({ error: `Role "${role}" has no verify config` }, { status: 500 });
  }

  const roleSecretStatus = getRoleSecretStatus(role);
  if (!roleSecretStatus.secret) {
    return Response.json(
      { error: roleSecretStatus.error ?? `${config.envVar} not configured` },
      { status: 503 },
    );
  }

  const authSecretStatus = getAuthSecretStatus();
  if (!authSecretStatus.secret && TOKEN_ROLES.includes(role as TokenRole)) {
    return Response.json(
      { error: authSecretStatus.error ?? "AUTH_SECRET not configured" },
      { status: 503 },
    );
  }

  const ip = getClientIp(request);
  const { allowed, remaining, backendAvailable } = await checkRateLimit(role, ip);

  if (!backendAvailable && process.env.NODE_ENV === "production") {
    return Response.json(
      { error: "Rate limit backend unavailable for admin auth" },
      { status: 503 },
    );
  }

  if (!allowed) {
    return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const { bodyField, sanitize } = config.verify;
  const raw = typeof body?.[bodyField] === "string" ? (body[bodyField] as string) : "";
  const candidate = sanitize ? sanitize(raw) : raw.trim();

  if (safeCompare(candidate, roleSecretStatus.secret)) {
    await clearRateLimit(role, ip);
    if (!TOKEN_ROLES.includes(role as TokenRole)) {
      return Response.json({ ok: true });
    }
    const tokenRole = role as TokenRole;
    const ua = request.headers.get("user-agent") ?? "";
    const redis = getRedis();
    const dedupeKey = loginDedupeKey(tokenRole, ip, ua);
    if (redis) {
      try {
        const recent = await redis.get<string>(dedupeKey);
        if (typeof recent === "string" && recent) {
          const payload = await verifyToken(recent, tokenRole);
          if (payload) {
            return Response.json({ ok: true, token: recent });
          }
        }
      } catch {
        if (process.env.NODE_ENV === "production") {
          return Response.json(
            { error: "Session storage is temporarily unavailable" },
            { status: 503 },
          );
        }
      }
    }

    const token = await signToken(tokenRole);
    if (!token) {
      return Response.json({ error: "Token generation failed" }, { status: 503 });
    }
    // Best-effort session registration and dedupe tracking (Redis-backed).
    if (redis) {
      try {
        const issuedAt = Math.floor(Date.now() / 1000);
        const parts = token.split(".");
        if (parts.length === 3) {
          const payloadJson = JSON.parse(base64UrlDecode(parts[1]).toString()) as TokenPayload;
          const ttlSeconds = Math.max(1, payloadJson.exp - issuedAt);
          await redis.set(`auth:session:${payloadJson.jti}`, {
            role: payloadJson.role,
            iat: payloadJson.iat,
            exp: payloadJson.exp,
            tv: payloadJson.tv,
            ip,
            ua,
          });
          await redis.expire(`auth:session:${payloadJson.jti}`, ttlSeconds + 60);
          await redis.sadd("auth:sessions:index", payloadJson.jti);
          await redis.expire("auth:sessions:index", 60 * 60 * 24 * 60); // keep index around for 60 days
          await redis.set(dedupeKey, token);
          await redis.expire(dedupeKey, LOGIN_DEDUPE_WINDOW_SECONDS);
        }
      } catch {
        if (process.env.NODE_ENV === "production") {
          return Response.json(
            { error: "Session storage is temporarily unavailable" },
            { status: 503 },
          );
        }
      }
    } else if (process.env.NODE_ENV === "production") {
      return Response.json(
        { error: "Session storage is temporarily unavailable" },
        { status: 503 },
      );
    }
    return Response.json({ ok: true, token });
  }

  return Response.json(
    {
      error: `Invalid ${bodyField}`,
      ...(remaining > 1 ? { attemptsRemaining: remaining - 1 } : {}),
    },
    { status: 401 },
  );
}

/* ─── Exports ─── */

export {
  requireAuth,
  requireAuthWithPayload,
  requireAdminStepUp,
  createAdminStepUpToken,
  handleVerifyRequest,
  revokeRoleTokens,
  revokeAllRoleTokens,
  getSecurityWarnings,
  safeCompare,
  getClientIp,
  isValidTokenJti,
  authenticateRequest,
  getLocalDevAdminCookieValue,
  isLocalDevelopment,
};
export type { AuthRole, RevocableRole };

type ServerContextAuthResult =
  | { ok: true; role: TokenRole; token: string; payload: TokenPayload }
  | { ok: true; role: "cron"; token: string; payload: null }
  | { ok: false; status: 401 | 503; error: string };

/**
 * Authenticate a request. Checks `Authorization: Bearer` first, then falls back
 * to httpOnly cookies.
 */
async function authenticateRequest(
  request: Request,
  role: AuthRole,
): Promise<ServerContextAuthResult> {
  if (role === "cron") {
    const { secret, error } = getRoleSecretStatus("cron");
    if (!secret) return { ok: false, status: 503, error: error ?? "CRON_SECRET not configured" };
    const candidate =
      request.headers
        .get("authorization")
        ?.replace(/^Bearer /, "")
        .trim() ?? "";
    if (!candidate || !safeCompare(candidate, secret)) {
      return { ok: false, status: 401, error: "Unauthorized" };
    }
    return { ok: true, role: "cron", token: candidate, payload: null };
  }

  if (role === "admin" || role === "upload") {
    const localAuth = getLocalDevAdminAuth(request);
    if (localAuth) {
      return { ok: true, role: "admin", token: localAuth.token, payload: localAuth.payload };
    }
  }

  const acceptedRoles = role === "upload" ? (["admin", "upload"] as const) : ([role] as const);

  const rawAuth = request.headers.get("authorization") ?? "";
  const bearer = rawAuth.startsWith("Bearer ") ? rawAuth.slice(7).trim() : "";

  let token = bearer;
  let tokenRole: TokenRole | null = null;
  if (!token) {
    for (const r of acceptedRoles) {
      const v = getCookie(request, getAuthCookieName(r));
      if (v) {
        token = v;
        tokenRole = r;
        break;
      }
    }
  }

  if (!token) {
    const openAuth = role === "upload" ? await getOpenUploadAuth(request) : null;
    if (openAuth)
      return { ok: true, role: "upload", token: openAuth.token, payload: openAuth.payload };
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const payload = await verifyTokenForRoles(token, acceptedRoles);
  if (!payload) {
    const openAuth = role === "upload" ? await getOpenUploadAuth(request) : null;
    if (openAuth)
      return { ok: true, role: "upload", token: openAuth.token, payload: openAuth.payload };
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true, role: tokenRole ?? payload.role, token, payload };
}

/** Revoke the session used by a sign-out request before clearing its cookie. */
async function revokeCurrentSession(request: Request, role: TokenRole): Promise<boolean> {
  const token = extractBearer(request) || extractTokenFromCookies(request, role);
  if (!token) return true;
  const payload = await verifyToken(token, role);
  if (!payload) return process.env.NODE_ENV !== "production";

  const redis = getRedis();
  if (!redis) return process.env.NODE_ENV !== "production";
  try {
    const ttl = Math.max(1, payload.exp - Math.floor(Date.now() / 1000));
    await redis.set(`auth:revoked-jti:${payload.jti}`, 1);
    await redis.expire(`auth:revoked-jti:${payload.jti}`, ttl);
    return true;
  } catch {
    return false;
  }
}

export { revokeCurrentSession };
