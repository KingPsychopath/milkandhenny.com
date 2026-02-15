/**
 * Server-side authentication.
 *
 * Config-driven auth for any number of roles. Every comparison is
 * timing-safe, every verify endpoint is rate-limited.
 *
 * To add a new role:
 *   1. Add an env var
 *   2. Add an entry to ROLES
 *   3. Use requireAuth() in your route, or handleVerifyRequest() for a gate
 *
 * @example Route protection
 * ```ts
 * const err = requireAuth(request, "upload");
 * if (err) return err;
 * ```
 *
 * @example Verify endpoint
 * ```ts
 * export async function POST(request: NextRequest) {
 *   return handleVerifyRequest(request, "staff");
 * }
 * ```
 */

import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "./redis";

/* ─── Types ─── */

type HeaderScheme = {
  /** Header name to read (case-insensitive). */
  name: string;
  /** Prefix to strip (e.g. "Bearer ", "PIN "). Raw value used if omitted. */
  prefix?: string;
};

type VerifyConfig = {
  /** JSON body field containing the candidate secret (e.g. "pin", "password"). */
  bodyField: string;
  /** Sanitize input before comparison (e.g. strip non-digits for numeric PINs). */
  sanitize?: (value: string) => string;
};

type RoleConfig = {
  /** Environment variable holding the secret. */
  envVar: string;
  /** How the secret travels in request headers for requireAuth(). */
  header: HeaderScheme;
  /** Client-facing verify endpoint config. Omit for server-only roles like cron. */
  verify?: VerifyConfig;
};

/* ─── Role definitions ─── */

type AuthRole = "staff" | "management" | "upload" | "cron";

const ROLES: Record<AuthRole, RoleConfig> = {
  staff: {
    envVar: "STAFF_PIN",
    header: { name: "authorization", prefix: "PIN " },
    verify: {
      bodyField: "pin",
      sanitize: (v: string) => v.replace(/\D/g, ""),
    },
  },
  management: {
    envVar: "MANAGEMENT_PASSWORD",
    header: { name: "x-management-password" },
    verify: { bodyField: "password" },
  },
  upload: {
    envVar: "UPLOAD_PIN",
    header: { name: "authorization", prefix: "PIN " },
    verify: { bodyField: "pin" },
  },
  cron: {
    envVar: "CRON_SECRET",
    header: { name: "authorization", prefix: "Bearer " },
  },
};

/* ─── Primitives ─── */

/** Constant-time string comparison. Prevents timing side-channel attacks. */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Extract client IP from proxy headers (Vercel, Cloudflare, nginx). */
function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/* ─── Secret access ─── */

/** Read the secret from the role's env var. Null if not configured. */
function getSecret(role: AuthRole): string | null {
  return process.env[ROLES[role].envVar] ?? null;
}

/** Extract the secret from request headers using the role's header scheme. */
function extractFromHeader(request: NextRequest, role: AuthRole): string {
  const { name, prefix } = ROLES[role].header;
  const raw = request.headers.get(name) ?? "";
  if (!prefix) return raw;
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : "";
}

/** Timing-safe comparison of a candidate against a role's configured secret. */
function verifySecret(role: AuthRole, candidate: string): boolean {
  const secret = getSecret(role);
  if (!secret || !candidate) return false;
  return safeCompare(candidate, secret);
}

/* ─── Rate limiting (internal) ─── */

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
 * Protect an API route. Returns null when authorized, or an error response
 * to return immediately (401 / 503).
 *
 * Reads the secret from the request header defined in the role's config,
 * then does a timing-safe comparison against the env var.
 */
function requireAuth(
  request: NextRequest,
  role: AuthRole
): NextResponse | null {
  const secret = getSecret(role);
  if (!secret) {
    return NextResponse.json(
      { error: `${ROLES[role].envVar} not configured` },
      { status: 503 }
    );
  }

  const candidate = extractFromHeader(request, role);
  if (!candidate || !safeCompare(candidate, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

/* ─── Verify handler ─── */

/**
 * Handle a POST verify endpoint with rate limiting and timing-safe comparison.
 * Body field, sanitization, and env var are all read from the role's config
 * in ROLES — no options needed at the call site.
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
    return NextResponse.json({ ok: true });
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

export { requireAuth, handleVerifyRequest, verifySecret, safeCompare, getClientIp };
export type { AuthRole };
