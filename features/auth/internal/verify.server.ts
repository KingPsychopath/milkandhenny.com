import { getRedis } from "@/lib/platform/redis.server";
import { checkRateLimit, clearRateLimit } from "./rate-limit.server";
import {
  LOGIN_DEDUPE_WINDOW_SECONDS,
  MIN_ADMIN_PASSWORD_LENGTH,
  MIN_AUTH_SECRET_LENGTH,
  MIN_UPLOAD_PIN_LENGTH,
  REVOCABLE_ROLES,
  ROLES,
  TOKEN_ROLES,
  base64UrlDecode,
  getAuthSecretStatus,
  getClientIp,
  getRawEnv,
  getRoleSecretStatus,
  loginDedupeKey,
  safeCompare,
  signToken,
  tokenVersionKey,
  validateSecretStrength,
  verifyToken,
  type AuthRole,
  type RevocableRole,
  type TokenPayload,
  type TokenRole,
} from "./token-session.server";

export async function revokeRoleTokens(
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
export async function revokeAllRoleTokens(): Promise<
  Array<{ role: RevocableRole; tokenVersion: number }>
> {
  const results: Array<{ role: RevocableRole; tokenVersion: number }> = [];
  for (const role of REVOCABLE_ROLES) {
    results.push(await revokeRoleTokens(role));
  }
  return results;
}

/** Human-readable environment warnings for admin/debug surfaces. */
export function getSecurityWarnings(): string[] {
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
export async function handleVerifyRequest(request: Request, role: AuthRole): Promise<Response> {
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
