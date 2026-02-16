import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getRedis } from "@/lib/redis";
import { apiError } from "@/lib/api-error";

const CODE_KEY_PREFIX = "best-dressed:code:";
const CODE_INDEX_KEY = "best-dressed:code-index";
const CODE_SCAN_MATCH = "best-dressed:code:*";
const SCAN_COUNT = 200;
const MAX_SCAN_KEYS = 5000;

function codeKey(code: string): string {
  return `${CODE_KEY_PREFIX}${code}`;
}

/**
 * POST /api/best-dressed/codes/revoke-all
 *
 * Revoke all currently minted one-time vote codes by deleting all known code keys.
 * Requires staff auth (admin JWT also works as staff).
 *
 * This uses a Redis set index that is maintained when minting codes.
 * For backwards compatibility, it falls back to SCAN+DEL if the index is empty.
 *
 * Returns: { success: true, deleted, indexed, scanned }
 */
export async function POST(request: NextRequest) {
  const authErr = await requireAuth(request, "staff");
  if (authErr) return authErr;

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { error: "Redis not configured (vote codes unavailable)" },
      { status: 503 }
    );
  }

  try {
    const codes = await redis.smembers<string[]>(CODE_INDEX_KEY);
    const indexed = Array.isArray(codes) ? codes.length : 0;
    let deleted = 0;
    let scanned = 0;

    if (codes && codes.length > 0) {
      const pipeline = redis.pipeline();
      for (const code of codes) {
        if (typeof code !== "string" || !code.trim()) continue;
        pipeline.del(codeKey(code.trim()));
      }
      // Drop the index so we don't keep stale entries.
      pipeline.del(CODE_INDEX_KEY);

      const results = await pipeline.exec();
      for (const r of results) {
        if (typeof r === "number") deleted += r;
      }
    } else {
      // Index is empty (older codes were minted before indexing existed).
      // Scan and delete any matching code keys directly.
      let cursor = 0;
      while (true) {
        // @upstash/redis SCAN typically returns [nextCursor, keys]
        const res = (await redis.scan(cursor, { match: CODE_SCAN_MATCH, count: SCAN_COUNT })) as unknown;
        const tuple = Array.isArray(res) ? (res as [number, string[]]) : ([0, []] as [number, string[]]);
        const nextCursor = typeof tuple[0] === "number" ? tuple[0] : 0;
        const keys = Array.isArray(tuple[1]) ? tuple[1] : [];

        if (keys.length > 0) {
          const pipeline = redis.pipeline();
          for (const key of keys) {
            if (typeof key !== "string" || !key.startsWith(CODE_KEY_PREFIX)) continue;
            pipeline.del(key);
          }
          const results = await pipeline.exec();
          for (const r of results) {
            if (typeof r === "number") deleted += r;
          }
        }

        scanned += keys.length;
        cursor = nextCursor;

        if (cursor === 0) break;
        if (scanned >= MAX_SCAN_KEYS) break;
      }

      // Clear the index key in case it exists but is empty/corrupt.
      await redis.del(CODE_INDEX_KEY);
    }

    return NextResponse.json({
      success: true,
      deleted,
      indexed,
      scanned,
    });
  } catch (error) {
    return apiError(
      "best-dressed.codes.revoke-all",
      "Failed to revoke vote codes",
      error
    );
  }
}

