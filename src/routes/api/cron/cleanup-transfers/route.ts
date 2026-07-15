import { createFileRoute } from "@tanstack/react-router";
import { getRedis } from "@/lib/platform/redis.server";
import { requireAuth } from "@/features/auth/auth.server";
import {
  isTransferStorageConfigured,
  listPrefixes,
  listObjects,
  deleteObjects,
} from "@/lib/platform/r2.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger.server";

/**
 * Daily cron job: deletes orphaned R2 objects for expired transfers.
 *
 * 1. Lists all transfer prefixes in R2 (transfers/{id}/)
 * 2. Checks Redis for each — if the key is gone (TTL expired), delete R2 objects
 * 3. Cleans up the transfer:index SET
 *
 * Can be called by Railway cron, a VPS cron entry, or any external scheduler.
 */
export const dynamic = "force-dynamic";

async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "cron");
  if (authErr) return authErr;

  const startedAtMs = Date.now();
  const requestId = request.headers.get("x-request-id") ?? null;

  try {
    log.info("cron.cleanup-transfers", "Cron cleanup started", { requestId });

    const redis = getRedis();
    if (!redis || !isTransferStorageConfigured()) {
      log.warn("cron.cleanup-transfers", "Cron cleanup skipped (missing config)", { requestId });
      return Response.json({
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

    const indexedIdSet = new Set(indexedIds);
    const expiredIdSet = new Set(expiredIds);
    const orphanedR2Prefixes = allR2Ids.filter(
      (id) => !indexedIdSet.has(id) || expiredIdSet.has(id),
    ).length;

    const durationMs = Date.now() - startedAtMs;
    log.info("cron.cleanup-transfers", "Cron cleanup finished", {
      requestId,
      durationMs,
      expiredIndexEntries: expiredIds.length,
      orphanedR2Prefixes,
      deletedObjects,
    });

    return Response.json({
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

export const Route = createFileRoute("/api/cron/cleanup-transfers")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
    },
  },
});
