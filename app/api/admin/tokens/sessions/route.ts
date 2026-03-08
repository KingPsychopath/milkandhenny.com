import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { getRedis } from "@/lib/platform/redis";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

type SessionRecord = {
  jti: string;
  role: "admin" | "staff" | "upload";
  iat: number;
  exp: number;
  tv: number;
  ip: string | undefined;
  ua: string | undefined;
  status: "active" | "expired" | "revoked" | "invalidated";
};

const DEFAULT_SESSION_PAGE_SIZE = 100;
const MAX_SESSION_PAGE_SIZE = 250;

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { error: "Redis not configured (session listing unavailable)" },
      { status: 503 }
    );
  }

  try {
    const jtis: string[] = await redis.smembers("auth:sessions:index");
    const now = Math.floor(Date.now() / 1000);
    const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? DEFAULT_SESSION_PAGE_SIZE);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(MAX_SESSION_PAGE_SIZE, Math.max(1, Math.floor(rawLimit)))
      : DEFAULT_SESSION_PAGE_SIZE;

    // Fetch current token versions so we can flag invalidated sessions.
    const [adminTv, staffTv, uploadTv] = await Promise.all([
      redis.get<number>("auth:token-version:admin"),
      redis.get<number>("auth:token-version:staff"),
      redis.get<number>("auth:token-version:upload"),
    ]);
    const currentTv = {
      admin: typeof adminTv === "number" ? adminTv : 1,
      staff: typeof staffTv === "number" ? staffTv : 1,
      upload: typeof uploadTv === "number" ? uploadTv : 1,
    } as const;

    const pageJtis = jtis.slice(0, limit);
    const sessionPipeline = redis.pipeline();
    for (const jti of pageJtis) {
      sessionPipeline.get(`auth:session:${jti}`);
    }
    const sessionsRaw = await sessionPipeline.exec();

    const revokedPipeline = redis.pipeline();
    for (const jti of pageJtis) {
      revokedPipeline.exists(`auth:revoked-jti:${jti}`);
    }
    const revokedRaw = await revokedPipeline.exec();

    const raw = pageJtis.map((jti, index) => {
      const session = sessionsRaw[index] as
        | {
            role: SessionRecord["role"];
            iat: number;
            exp: number;
            tv: number;
            ip?: string;
            ua?: string;
          }
        | null;
      if (!session) return null;

      const revoked = revokedRaw[index] === 1;

      let status: SessionRecord["status"] = "active";
      if (session.exp <= now) status = "expired";
      else if (revoked) status = "revoked";
      else if (session.tv !== currentTv[session.role]) status = "invalidated";

      return {
        jti,
        role: session.role,
        iat: session.iat,
        exp: session.exp,
        tv: session.tv,
        ip: session.ip,
        ua: session.ua,
        status,
      } satisfies SessionRecord;
    });

    const sessions = raw
      .filter((s): s is SessionRecord => s !== null)
      .sort((a, b) => b.iat - a.iat);

    return NextResponse.json({
      success: true,
      count: sessions.length,
      totalIndexed: jtis.length,
      truncated: jtis.length > limit,
      sessions,
      now,
      currentTv,
    });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.tokens.sessions", "Failed to list token sessions", error);
  }
}
