import { NextRequest, NextResponse } from "next/server";
import { requireAdminStepUp, requireAuth } from "@/features/auth/server";
import { getRedis } from "@/lib/platform/redis";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

type RouteContext = {
  params: Promise<{ jti: string }>;
};

const SAFE_JTI = /^[0-9a-fA-F-]{32,40}$/;

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { error: "Redis not configured (session revoke unavailable)" },
      { status: 503 }
    );
  }

  const { jti } = await context.params;
  const clean = decodeURIComponent(jti).trim();
  if (!SAFE_JTI.test(clean)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  try {
    const session = await redis.get<{ exp: number }>(`auth:session:${clean}`);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const now = Math.floor(Date.now() / 1000);
    const ttl = Math.max(1, session.exp - now);
    await redis.set(`auth:revoked-jti:${clean}`, 1);
    await redis.expire(`auth:revoked-jti:${clean}`, ttl + 60);

    return NextResponse.json({ success: true, jti: clean, ttlSeconds: ttl });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.tokens.sessions.revoke",
      "Failed to revoke session",
      error,
      { jti: clean }
    );
  }
}

