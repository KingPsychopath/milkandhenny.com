import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { getCookie } from "@/lib/http/cookies";
import { getRedis } from "@/lib/platform/redis.server";
import { getAuthCookieName } from "../cookies";
import {
  ADMIN_STEP_UP_TTL_SECONDS,
  base64UrlDecode,
  base64UrlEncode,
  extractAuthTokenForAcceptedRoles,
  extractBearer,
  extractTokenFromCookies,
  getAuthSecretStatus,
  getLocalDevAdminAuth,
  getOpenUploadAuth,
  getRoleSecretStatus,
  safeCompare,
  verifyToken,
  verifyTokenForRoles,
  type AuthRole,
  type StepUpPayload,
  type TokenPayload,
  type TokenRole,
} from "./token-session.server";
import { LOCKOUT_SECONDS, clearStepUpFailures, reserveStepUpAttempt } from "./rate-limit.server";

export async function requireAuth(request: Request, role: AuthRole): Promise<Response | null> {
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
export async function requireAuthWithPayload(
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

export function signStepUpToken(parentJti: string): string | null {
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

export function verifyStepUpToken(token: string, parentJti: string): boolean {
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
export async function requireAdminStepUp(request: Request): Promise<Response | null> {
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
export async function createAdminStepUpToken(
  request: Request,
  password: string,
): Promise<Response> {
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
export type ServerContextAuthResult =
  | { ok: true; role: TokenRole; token: string; payload: TokenPayload }
  | { ok: true; role: "cron"; token: string; payload: null }
  | { ok: false; status: 401 | 503; error: string };

/**
 * Authenticate a request. Checks `Authorization: Bearer` first, then falls back
 * to httpOnly cookies.
 */
export async function authenticateRequest(
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
export async function revokeCurrentSession(request: Request, role: TokenRole): Promise<boolean> {
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
