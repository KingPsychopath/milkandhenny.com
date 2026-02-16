import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { requireAuth } from "@/lib/auth";
import { isConfigured, listPrefixes, listObjects, deleteObjects } from "@/lib/r2";
import { apiErrorFromRequest } from "@/lib/api-error";
import { log } from "@/lib/logger";

/**
 * Daily cron job: deletes orphaned R2 objects for expired transfers.
 *
 * 1. Lists all transfer prefixes in R2 (transfers/{id}/)
 * 2. Checks Redis for each — if the key is gone (TTL expired), delete R2 objects
 * 3. Cleans up the transfer:index SET
 *
 * Cost: 1 Vercel invocation/day + a few Redis reads + R2 list/delete ops.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request, "cron");
  if (authErr) return authErr;

  const startedAtMs = Date.now();
  const requestId = request.headers.get("x-request-id") ?? null;

  try {
    log.info("cron.cleanup-transfers", "Cron cleanup started", { requestId });

    const redis = getRedis();
    if (!redis || !isConfigured()) {
      log.warn("cron.cleanup-transfers", "Cron cleanup skipped (missing config)", { requestId });
      return NextResponse.json({
        skipped: true,
        reason: "Redis or R2 not configured",
      });
    }

    // Get all transfer IDs from the index
    const indexedIds: string[] = await redis.smembers("transfer:index");

    // Check which ones are still alive in Redis
    let expiredIds: string[] = [];
    if (indexedIds.length > 0) {
      const pipeline = redis.pipeline();
      for (const id of indexedIds) {
        pipeline.exists(`transfer:${id}`);
      }
      const results = await pipeline.exec();
      expiredIds = indexedIds.filter((_, i) => results[i] === 0);
    }

    // Clean up index for expired entries
    if (expiredIds.length > 0) {
      const cleanupPipeline = redis.pipeline();
      for (const id of expiredIds) {
        cleanupPipeline.srem("transfer:index", id);
      }
      await cleanupPipeline.exec();
    }

    // Scan R2 for any orphaned transfer prefixes not in the index
    const transferPrefixes = await listPrefixes("transfers/");
    const allR2Ids = transferPrefixes
      .map((p) => p.replace("transfers/", "").replace(/\/$/, ""))
      .filter(Boolean);

    // For each R2 transfer prefix, check if it's still alive in Redis
    let deletedObjects = 0;
    for (const id of allR2Ids) {
      const exists = await redis.exists(`transfer:${id}`);
      if (exists) continue;

      // Transfer expired — delete all R2 objects under this prefix
      const objects = await listObjects(`transfers/${id}/`);
      const keys = objects.map((o) => o.key);

      if (keys.length > 0) {
        deletedObjects += await deleteObjects(keys);
      }

      // Remove from index (belt + suspenders)
      await redis.srem("transfer:index", id);
    }

    const orphanedR2Prefixes = allR2Ids.filter(
      (id) => !indexedIds.includes(id) || expiredIds.includes(id)
    ).length;

    const durationMs = Date.now() - startedAtMs;
    log.info("cron.cleanup-transfers", "Cron cleanup finished", {
      requestId,
      durationMs,
      expiredIndexEntries: expiredIds.length,
      orphanedR2Prefixes,
      deletedObjects,
    });

    return NextResponse.json({
      success: true,
      expiredIndexEntries: expiredIds.length,
      orphanedR2Prefixes,
      deletedObjects,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromRequest(request, "cron.cleanup-transfers", "Cron cleanup failed", error, {
      durationMs: Date.now() - startedAtMs,
    });
  }
}
