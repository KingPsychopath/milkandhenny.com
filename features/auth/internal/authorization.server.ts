import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { getCookie } from "@/lib/http/cookies";
import { getRedis } from "@/lib/platform/redis.server";
import { getAuthCookieName } from "../cookies";
import {
  ADMIN_STEP_UP_TTL_SECONDS,
  base64UrlDecode,
  base64UrlEncode,
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
import {
  GLOBAL_ADMIN_ROLE_PRESETS,
  permissionsForGlobalRole,
  type GlobalAdminPermission,
  type GlobalAdminPermissionSet,
  type GlobalAdminRole,
} from "@/features/attendee-operations/types";

export async function requireAuth(request: Request, role: AuthRole): Promise<Response | null> {
  const auth = await authenticateRequest(request, role);
  return auth.ok ? null : Response.json({ error: auth.error }, { status: auth.status });
}

/**
 * Like `requireAuth`, but returns the decoded token payload (when applicable).
 * Useful when follow-up auth steps need the token's `jti` (e.g. admin step-up).
 */
export async function requireAuthWithPayload(
  request: Request,
  role: AuthRole,
): Promise<{
  error: Response | null;
  payload: TokenPayload | null;
  actorId: string | null;
  actorType: "root-owner" | TokenRole | "cron" | null;
}> {
  const auth = await authenticateRequest(request, role);
  if (!auth.ok)
    return {
      error: Response.json({ error: auth.error }, { status: auth.status }),
      payload: null,
      actorId: null,
      actorType: null,
    };
  if (!auth.payload) return { error: null, payload: null, actorId: "cron", actorType: "cron" };
  const namedAdmin = auth.role === "admin" && auth.token.startsWith("person:");
  return {
    error: null,
    payload: auth.payload,
    actorId: namedAdmin
      ? auth.payload.jti
      : auth.role === "admin"
        ? "root-owner"
        : auth.payload.jti,
    actorType: namedAdmin ? "admin" : auth.role === "admin" ? "root-owner" : auth.role,
  };
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
 * Issues an admin step-up token after re-checking the root password or a
 * named administrator's fresh verified-email session.
 * Designed for `/api/admin/step-up` and consumed via `x-admin-step-up`.
 */
export async function createAdminStepUpToken(
  request: Request,
  password?: string,
): Promise<Response> {
  const auth = await authenticateRequest(request, "admin");
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const payload = auth.payload;
  if (!payload) return Response.json({ error: "Unauthorized" }, { status: 401 });

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

  if (auth.token.startsWith("person:")) {
    const { getAttendeeSessionForRequest } =
      await import("@/features/event-scoring/session.server");
    const attendee = await getAttendeeSessionForRequest(request);
    const authenticatedAt = attendee?.authenticatedAt
      ? Date.parse(attendee.authenticatedAt)
      : Number.NaN;
    if (
      attendee?.personId !== payload.jti ||
      !Number.isFinite(authenticatedAt) ||
      Date.now() - authenticatedAt > ADMIN_STEP_UP_TTL_SECONDS * 1000
    ) {
      return Response.json(
        {
          error: "Verify your email again to continue with this protected action.",
          code: "FRESH_EMAIL_REQUIRED",
          returnTo: "/admin",
        },
        { status: 428 },
      );
    }
  } else {
    if (!password?.trim()) {
      return Response.json(
        { error: "Admin password is required", code: "PASSWORD_REQUIRED" },
        { status: 428 },
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

async function requiredNamedAdminPermission(
  request: Request,
  role: AuthRole,
): Promise<GlobalAdminPermission | null> {
  if (role === "upload") return "manageContent";
  const { pathname } = new URL(request.url);
  if (pathname.endsWith("/step-up") || pathname.endsWith("/verify")) return null;
  if (pathname.includes("/operations/inbox")) return "viewOperations";
  if (pathname.includes("/operations/access") || pathname.includes("/operations/alerts"))
    return "manageGlobalSettings";
  if (pathname.includes("/operations/settings")) return "manageGlobalSettings";
  if (pathname.includes("/operations/audit")) return "viewAudit";
  if (pathname.includes("/operations/directory") || pathname.includes("/people"))
    return "managePeople";
  if (pathname.includes("/communications") || pathname.includes("/email"))
    return "manageCommunications";
  if (
    pathname.includes("/scoring") ||
    pathname.includes("/discover") ||
    pathname.includes("/game-pools")
  )
    return "manageScoring";
  if (
    pathname.includes("/tickets") ||
    pathname.includes("/orders") ||
    pathname.includes("/refund")
  ) {
    if (request.method !== "GET") {
      const body = (await request
        .clone()
        .json()
        .catch(() => null)) as { action?: unknown } | null;
      if (body?.action === "refund") return "executeRefunds";
    }
    return request.method === "GET" ? "viewOperations" : "manageTickets";
  }
  if (pathname.includes("/events"))
    return request.method === "GET" ? "viewOperations" : "manageEvents";
  if (
    pathname.includes("/media") ||
    pathname.includes("/content") ||
    pathname.includes("/albums") ||
    pathname.includes("/word-shares") ||
    pathname.includes("/words") ||
    pathname.includes("/pitches") ||
    pathname.includes("/surveys") ||
    pathname.includes("/transfers")
  )
    return "manageContent";
  if (pathname.includes("/best-dressed")) return "manageScoring";
  if (pathname.includes("/reports")) return "viewAudit";
  if (
    pathname.includes("/tokens") ||
    pathname.includes("/upload-access") ||
    pathname.includes("/cli-auth")
  )
    return "manageGlobalSettings";
  return request.method === "GET" ? "viewOperations" : "manageGlobalSettings";
}

async function activeNamedAdmin(
  request: Request,
  role: AuthRole,
): Promise<{
  personId: string;
  payload: TokenPayload;
} | null> {
  const [{ getAttendeeSessionForRequest }, { query }] = await Promise.all([
    import("@/features/event-scoring/session.server"),
    import("@/lib/platform/postgres.server"),
  ]);
  const session = await getAttendeeSessionForRequest(request);
  if (!session?.personId || !session.authenticatedAt) return null;
  const grants = await query<{
    person_id: string;
    role_preset: string;
    overrides: Partial<GlobalAdminPermissionSet>;
  }>(
    `select person_id,role_preset,overrides from global_admin_grants
      where person_id = $1 and status = 'active' and starts_at <= now()
        and (expires_at is null or expires_at > now())
      order by case role_preset when 'owner' then 0 when 'admin' then 1 else 2 end,created_at
      `,
    [session.personId],
  );
  const requiredPermission = await requiredNamedAdminPermission(request, role);
  const grant = grants.find((candidate) => {
    if (!(candidate.role_preset in GLOBAL_ADMIN_ROLE_PRESETS)) return false;
    if (!requiredPermission) return true;
    return permissionsForGlobalRole(
      candidate.role_preset as GlobalAdminRole,
      candidate.overrides ?? {},
    )[requiredPermission];
  });
  if (!grant) return null;
  const now = Math.floor(Date.now() / 1000);
  return {
    personId: grant.person_id,
    payload: {
      role: "admin",
      iat: Math.floor(Date.parse(session.authenticatedAt) / 1000),
      exp: now + 60,
      jti: grant.person_id,
      tv: 0,
    },
  };
}

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

  const namedAdmin =
    role === "admin" || role === "upload" ? await activeNamedAdmin(request, role) : null;

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
    if (namedAdmin)
      return {
        ok: true,
        role: "admin",
        token: `person:${namedAdmin.personId}`,
        payload: namedAdmin.payload,
      };
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const payload = await verifyTokenForRoles(token, acceptedRoles);
  if (!payload) {
    const openAuth = role === "upload" ? await getOpenUploadAuth(request) : null;
    if (openAuth)
      return { ok: true, role: "upload", token: openAuth.token, payload: openAuth.payload };
    if (namedAdmin)
      return {
        ok: true,
        role: "admin",
        token: `person:${namedAdmin.personId}`,
        payload: namedAdmin.payload,
      };
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

export const __authorizationTesting = { requiredNamedAdminPermission };
