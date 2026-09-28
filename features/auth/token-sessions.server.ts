import {
  listPostgresTokenSessions,
  postgresTokenStoreSelected,
} from "./internal/token-state-postgres.server";
import { getRedis } from "@/lib/platform/redis.server";

type SessionRecord = {
  jti: string;
  role: "admin" | "upload";
  iat: number;
  exp: number;
  tv: number;
  ip: string | undefined;
  ua: string | undefined;
  source: "browser" | "cli" | "unknown";
  status: "active" | "expired" | "revoked" | "invalidated";
};

export class TokenSessionsUnavailableError extends Error {
  constructor() {
    super("Redis not configured (session listing unavailable)");
  }
}

export function boundTokenSessionLimit(value: number): number {
  return Number.isFinite(value) ? Math.min(250, Math.max(1, Math.floor(value))) : 100;
}

/** One session read for both the admin UI and the HTTP/CLI contract. */
export async function listTokenSessions(limit = 100) {
  const bounded = boundTokenSessionLimit(limit);
  if (postgresTokenStoreSelected()) return listPostgresTokenSessions(bounded);

  const redis = getRedis();
  if (!redis) throw new TokenSessionsUnavailableError();

  const jtis: string[] = await redis.smembers("auth:sessions:index");
  const now = Math.floor(Date.now() / 1000);
  const [adminTv, uploadTv] = await Promise.all([
    redis.get<number>("auth:token-version:admin"),
    redis.get<number>("auth:token-version:upload"),
  ]);
  const currentTv = {
    admin: typeof adminTv === "number" ? adminTv : 1,
    upload: typeof uploadTv === "number" ? uploadTv : 1,
  } as const;

  const pageJtis = jtis.slice(0, bounded);
  const sessionPipeline = redis.pipeline();
  for (const jti of pageJtis) sessionPipeline.get(`auth:session:${jti}`);
  const sessionsRaw = await sessionPipeline.exec();

  const revokedPipeline = redis.pipeline();
  for (const jti of pageJtis) revokedPipeline.exists(`auth:revoked-jti:${jti}`);
  const revokedRaw = await revokedPipeline.exec();

  const sessions = pageJtis
    .map((jti, index): SessionRecord | null => {
      const session = sessionsRaw[index] as {
        role: SessionRecord["role"];
        iat: number;
        exp: number;
        tv: number;
        ip?: string;
        ua?: string;
        source?: "browser" | "cli" | "unknown";
      } | null;
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
        source: session.source ?? (session.ua?.includes("milkandhenny-cli") ? "cli" : "browser"),
        status,
      };
    })
    .filter((session): session is SessionRecord => session !== null)
    .sort((a, b) => b.iat - a.iat);

  return {
    success: true,
    count: sessions.length,
    totalIndexed: jtis.length,
    truncated: jtis.length > bounded,
    sessions,
    now,
    currentTv,
  };
}
