import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getRedis } from "@/lib/redis";
import { apiErrorFromRequest } from "@/lib/api-error";

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

    // For small lists, parallel is fine. If this grows large, we can page.
    const raw = await Promise.all(
      jtis.slice(0, 250).map(async (jti) => {
        const session = await redis.get<{
          role: SessionRecord["role"];
          iat: number;
          exp: number;
          tv: number;
          ip?: string;
          ua?: string;
        }>(`auth:session:${jti}`);

        if (!session) return null;
        const revoked = await redis.exists(`auth:revoked-jti:${jti}`);

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
      })
    );

    const sessions = raw
      .filter((s): s is SessionRecord => s !== null)
      .sort((a, b) => b.iat - a.iat);

    return NextResponse.json({
      success: true,
      count: sessions.length,
      sessions,
      now,
      currentTv,
    });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.tokens.sessions", "Failed to list token sessions", error);
  }
}

