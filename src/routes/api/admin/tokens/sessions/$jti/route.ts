import { createFileRoute } from "@tanstack/react-router";
import { isValidTokenJti, requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { getRedis } from "@/lib/platform/redis.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

type RouteContext = {
  params: Promise<{ jti: string }>;
};

async function handleDELETE(request: Request, context: RouteContext) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  const redis = getRedis();
  if (!redis) {
    return Response.json(
      { error: "Redis not configured (session revoke unavailable)" },
      { status: 503 },
    );
  }

  const { jti } = await context.params;
  const clean = decodeURIComponent(jti).trim();
  if (!isValidTokenJti(clean)) {
    return Response.json({ error: "Invalid session id" }, { status: 400 });
  }

  try {
    const session = await redis.get<{ exp: number }>(`auth:session:${clean}`);
    if (!session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    const now = Math.floor(Date.now() / 1000);
    const ttl = Math.max(1, session.exp - now);
    await redis.set(`auth:revoked-jti:${clean}`, 1);
    await redis.expire(`auth:revoked-jti:${clean}`, ttl + 60);

    return Response.json({ success: true, jti: clean, ttlSeconds: ttl });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.tokens.sessions.revoke",
      "Failed to revoke session",
      error,
      { jti: clean },
    );
  }
}

export const Route = createFileRoute("/api/admin/tokens/sessions/$jti")({
  server: {
    handlers: {
      DELETE: ({ request, params }) => handleDELETE(request, { params: Promise.resolve(params) }),
    },
  },
});
