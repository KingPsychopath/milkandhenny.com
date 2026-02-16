/**
 * Server-side authentication.
 *
 * Token-based flow: verify endpoint validates PIN/password, issues short-lived JWT.
 * Client stores token (not credentials), sends Authorization: Bearer <token>.
 *
 * Config-driven. Every comparison is timing-safe, every verify endpoint is rate-limited.
 * Cron uses Bearer secret directly (no verify flow).
 *
 * Env: AUTH_SECRET (JWT signing), STAFF_PIN, ADMIN_PASSWORD, UPLOAD_PIN, CRON_SECRET
 */

import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "./redis";

/* ─── Types ─── */

type VerifyConfig = {
  bodyField: string;
  sanitize?: (value: string) => string;
};

type RoleConfig = {
  envVar: string;
  verify?: VerifyConfig;
};

type AuthRole = "staff" | "admin" | "upload" | "cron";

const ROLES: Record<AuthRole, RoleConfig> = {
  staff: {
    envVar: "STAFF_PIN",
    verify: { bodyField: "pin", sanitize: (v: string) => v.replace(/\D/g, "") },
  },
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

const TOKEN_ROLES: AuthRole[] = ["staff", "admin", "upload"];
const TOKEN_EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours

/* ─── JWT (HS256, no deps) ─── */

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function base64UrlDecode(str: string): Buffer {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  return Buffer.from(padded, "base64");
}

function getAuthSecret(): string | null {
  const raw = process.env.AUTH_SECRET;
  if (!raw) return null;
  return raw.trim() || null;
}

/** Sign a JWT for the given role. Payload: { role, exp, iat }. */
function signToken(role: AuthRole): string | null {
  const secret = getAuthSecret();
  if (!secret) return null;

  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    role,
    iat: now,
    exp: now + TOKEN_EXPIRY_SECONDS,
  };

  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const message = `${headerB64}.${payloadB64}`;

  const sig = createHmac("sha256", secret)
    .update(message)
    .digest();
  const sigB64 = base64UrlEncode(sig);

  return `${message}.${sigB64}`;
}

type TokenPayload = { role: string; exp: number; iat: number };

/** Verify JWT and return payload if valid for the expected role. */
function verifyToken(token: string, expectedRole: AuthRole): TokenPayload | null {
  const secret = getAuthSecret();
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
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  const expectedSig = createHmac("sha256", secret).update(message).digest();
  const actualSig = base64UrlDecode(sigB64);
  if (actualSig.length !== expectedSig.length || !timingSafeEqual(actualSig, expectedSig)) {
    return null;
  }

  return payload;
}

function verifyTokenForRoles(
  token: string,
  acceptedRoles: readonly AuthRole[]
): TokenPayload | null {
  for (const role of acceptedRoles) {
    const payload = verifyToken(token, role);
    if (payload) return payload;
  }
  return null;
}

/* ─── Primitives ─── */

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function getSecret(role: AuthRole): string | null {
  const raw = process.env[ROLES[role].envVar];
  if (!raw) return null;
  return raw.trim() || null;
}

function extractBearer(request: NextRequest): string {
  const raw = request.headers.get("authorization") ?? "";
  return raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
}

/* ─── Rate limiting ─── */

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 900;

async function checkRateLimit(
  role: AuthRole,
  ip: string
): Promise<{ allowed: boolean; remaining: number }> {
  const redis = getRedis();
  if (!redis) return { allowed: true, remaining: MAX_ATTEMPTS };

  const key = `auth:ratelimit:${role}:${ip}`;
  const attempts = (await redis.get<number>(key)) ?? 0;

  if (attempts >= MAX_ATTEMPTS) return { allowed: false, remaining: 0 };
  return { allowed: true, remaining: MAX_ATTEMPTS - attempts };
}

async function recordFailure(role: AuthRole, ip: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const key = `auth:ratelimit:${role}:${ip}`;
  await redis.incr(key);
  await redis.expire(key, LOCKOUT_SECONDS);
}

async function clearRateLimit(role: AuthRole, ip: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.del(`auth:ratelimit:${role}:${ip}`);
}

/* ─── Route guard ─── */

/**
 * Protect an API route. Returns null when authorized, or an error response.
 *
 * For staff/admin/upload: Validates JWT (Authorization: Bearer <token>).
 * For cron: Validates Bearer secret directly.
 */
function requireAuth(
  request: NextRequest,
  role: AuthRole
): NextResponse | null {
  if (role === "cron") {
    const secret = getSecret("cron");
    if (!secret) {
      return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
    }
    const candidate = extractBearer(request);
    if (!candidate || !safeCompare(candidate, secret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return null;
  }

  const token = extractBearer(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const acceptedRoles =
    role === "staff"
      ? (["staff", "admin"] as const)
      : role === "upload"
        ? (["upload", "admin"] as const)
        : ([role] as const);
  const payload = verifyTokenForRoles(token, acceptedRoles);
  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

/* ─── Verify handler ─── */

/**
 * Handle a POST verify endpoint. On success, issues a JWT token.
 * Client stores token, sends it as Authorization: Bearer <token>.
 */
async function handleVerifyRequest(
  request: NextRequest,
  role: AuthRole
): Promise<NextResponse> {
  const config = ROLES[role];

  if (!config.verify) {
    return NextResponse.json(
      { error: `Role "${role}" has no verify config` },
      { status: 500 }
    );
  }

  const secret = getSecret(role);
  if (!secret) {
    return NextResponse.json(
      { error: `${config.envVar} not configured` },
      { status: 503 }
    );
  }

  const authSecret = getAuthSecret();
  if (!authSecret && TOKEN_ROLES.includes(role)) {
    return NextResponse.json(
      { error: "AUTH_SECRET not configured" },
      { status: 503 }
    );
  }

  const ip = getClientIp(request);
  const { allowed, remaining } = await checkRateLimit(role, ip);

  if (!allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { bodyField, sanitize } = config.verify;
  const raw =
    typeof body?.[bodyField] === "string"
      ? (body[bodyField] as string)
      : "";
  const candidate = sanitize ? sanitize(raw) : raw.trim();

  if (safeCompare(candidate, secret)) {
    await clearRateLimit(role, ip);
    const token = signToken(role);
    if (!token) {
      return NextResponse.json(
        { error: "Token generation failed" },
        { status: 503 }
      );
    }
    return NextResponse.json({ ok: true, token });
  }

  await recordFailure(role, ip);
  return NextResponse.json(
    {
      error: `Invalid ${bodyField}`,
      ...(remaining > 1 ? { attemptsRemaining: remaining - 1 } : {}),
    },
    { status: 401 }
  );
}

/* ─── Exports ─── */

export { requireAuth, handleVerifyRequest, safeCompare, getClientIp };
export type { AuthRole };
