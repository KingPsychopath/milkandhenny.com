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
} from "../cookies";
import { authenticateUploadAccess } from "../upload-access.server";

/* ─── Types ─── */

export type VerifyConfig = {
  bodyField: string;
  sanitize?: (value: string) => string;
};

export type RoleConfig = {
  envVar: string;
  verify?: VerifyConfig;
};

export type AuthRole = "admin" | "upload" | "cron";
export type TokenRole = Exclude<AuthRole, "cron">;
export type RevocableRole = Exclude<AuthRole, "cron">;

export const ROLES: Record<AuthRole, RoleConfig> = {
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

export const TOKEN_ROLES: TokenRole[] = ["admin", "upload"];
export const REVOCABLE_ROLES: readonly RevocableRole[] = ["admin", "upload"];
export const TOKEN_EXPIRY_SECONDS_BY_ROLE: Record<TokenRole, number> = {
  admin: 60 * 60, // 1h
  upload: 12 * 60 * 60, // 12h
};
export const ADMIN_STEP_UP_TTL_SECONDS = 5 * 60;
export const LOGIN_DEDUPE_WINDOW_SECONDS = 15;
export const MIN_AUTH_SECRET_LENGTH = 32;
export const MIN_ADMIN_PASSWORD_LENGTH = 12;
export const MIN_UPLOAD_PIN_LENGTH = 12;
export const WEAK_SECRET_VALUES = new Set([
  "password",
  "password123",
  "admin",
  "admin123",
  "changeme",
  "letmein",
  "123456",
  "qwerty",
]);

export function isLocalDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

// This value only exists in a local development server process. A random value
// keeps the convenience cookie scoped to the process that issued it.
export const LOCAL_DEV_ADMIN_COOKIE_VALUE = isLocalDevelopment()
  ? randomBytes(32).toString("hex")
  : null;

export function getLocalDevAdminCookieValue(): string | null {
  return LOCAL_DEV_ADMIN_COOKIE_VALUE;
}

export function isLocalDevAdminRequest(request: Request): boolean {
  const value = getCookie(request, LOCAL_DEV_ADMIN_COOKIE);
  const expected = getLocalDevAdminCookieValue();
  return Boolean(value && expected && safeCompare(value, expected));
}

export function getLocalDevAdminPayload(): TokenPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    role: "admin",
    iat: now,
    exp: now + LOCAL_DEV_ADMIN_COOKIE_MAX_AGE_SECONDS,
    jti: "local-dev-admin",
    tv: 1,
  };
}

export function getLocalDevAdminAuth(request: Request): {
  token: string;
  payload: TokenPayload;
} | null {
  if (!isLocalDevelopment() || !isLocalDevAdminRequest(request)) return null;
  const token = getLocalDevAdminCookieValue();
  if (!token) return null;
  return { token, payload: getLocalDevAdminPayload() };
}

export function tokenVersionKey(role: RevocableRole): string {
  return `auth:token-version:${role}`;
}

export function loginDedupeKey(role: TokenRole, ip: string, ua: string): string {
  const fingerprint = createHash("sha256")
    .update(`${role}|${ip || "unknown"}|${ua || "unknown"}`)
    .digest("hex")
    .slice(0, 24);
  return `auth:recent-login:${role}:${fingerprint}`;
}

/* ─── JWT (HS256, no deps) ─── */

export function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function base64UrlDecode(str: string): Buffer {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  return Buffer.from(padded, "base64");
}

export function getRawEnv(name: string): string | null {
  const raw = process.env[name];
  if (!raw) return null;
  return raw.trim() || null;
}

export function validateSecretStrength(
  label: string,
  value: string,
  minLength: number,
): string | null {
  if (value.length < minLength) {
    return `${label} is too weak (minimum ${minLength} characters required)`;
  }
  if (WEAK_SECRET_VALUES.has(value.toLowerCase())) {
    return `${label} is too weak (common secret value)`;
  }
  return null;
}

export function getAuthSecretStatus(): { secret: string | null; error: string | null } {
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

export function getRoleSecretStatus(role: AuthRole): {
  secret: string | null;
  error: string | null;
} {
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

export async function getCurrentTokenVersion(role: RevocableRole): Promise<number | null> {
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
export function generateTokenJti(): string {
  // Include UUID + random bytes + timestamp so test/runtime entropy differences
  // cannot accidentally produce the same session id.
  return `${Date.now().toString(36)}-${randomUUID()}-${randomBytes(6).toString("hex")}`;
}

export function isValidTokenJti(value: string): boolean {
  return value.length <= 128 && /^[a-z0-9]+-[0-9a-f-]{36}-[0-9a-f]{12}$/i.test(value);
}

export async function signToken(role: TokenRole): Promise<string | null> {
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

export type TokenSessionSource = "browser" | "cli";

export async function registerTokenSession(
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

export type TokenPayload = { role: TokenRole; exp: number; iat: number; jti: string; tv: number };
export type StepUpPayload = {
  kind: "admin-step-up";
  parentJti: string;
  iat: number;
  exp: number;
  nonce: string;
};

export async function getOpenUploadAuth(
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
export async function verifyToken(
  token: string,
  expectedRole: TokenRole,
): Promise<TokenPayload | null> {
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

export async function verifyTokenForRoles(
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
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Resolve the peer address supplied by the Nitro/H3 request context. */
export function getClientIp(_request: Request): string {
  // Resolve the peer address from the Nitro/H3 request context. Do not trust
  // client-controlled forwarding headers in application code.
  try {
    const ip = getRequestIP();
    return typeof ip === "string" && isIP(ip) ? ip : "unknown";
  } catch {
    return "unknown";
  }
}

export function extractBearer(request: Request): string {
  const raw = request.headers.get("authorization") ?? "";
  return raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
}

export function extractTokenFromCookies(request: Request, role: TokenRole): string {
  return getCookie(request, getAuthCookieName(role));
}

export function extractAuthTokenForAcceptedRoles(
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
