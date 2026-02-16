import { NextRequest, NextResponse } from "next/server";
import { requireAdminStepUp, requireAuth } from "@/lib/auth";
import { getRedis } from "@/lib/redis";
import { isConfigured, listPrefixes, listObjects, deleteObjects } from "@/lib/r2";
import { apiErrorFromRequest } from "@/lib/api-error";

/**
 * On-demand admin cleanup for expired/orphaned transfers.
 * Mirrors cron behavior but is manually triggered from dashboard.
 */
export async function POST(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  const redis = getRedis();
  if (!redis || !isConfigured()) {
    return NextResponse.json(
      { error: "Redis or R2 not configured" },
      { status: 503 }
    );
  }

  try {
    const indexedIds: string[] = await redis.smembers("transfer:index");

    let expiredIds: string[] = [];
    if (indexedIds.length > 0) {
      const pipeline = redis.pipeline();
      for (const id of indexedIds) {
        pipeline.exists(`transfer:${id}`);
      }
      const results = await pipeline.exec();
      expiredIds = indexedIds.filter((_, i) => results[i] === 0);
    }

    if (expiredIds.length > 0) {
      const cleanupPipeline = redis.pipeline();
      for (const id of expiredIds) {
        cleanupPipeline.srem("transfer:index", id);
      }
      await cleanupPipeline.exec();
    }

    const transferPrefixes = await listPrefixes("transfers/");
    const allR2Ids = transferPrefixes
      .map((p) => p.replace("transfers/", "").replace(/\/$/, ""))
      .filter(Boolean);

    let deletedObjects = 0;
    for (const id of allR2Ids) {
      const exists = await redis.exists(`transfer:${id}`);
      if (exists) continue;

      const objects = await listObjects(`transfers/${id}/`);
      const keys = objects.map((o) => o.key);
      if (keys.length > 0) {
        deletedObjects += await deleteObjects(keys);
      }
      await redis.srem("transfer:index", id);
    }

    return NextResponse.json({
      success: true,
      expiredIndexEntries: expiredIds.length,
      scannedPrefixes: allR2Ids.length,
      deletedObjects,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.transfers.cleanup",
      "Failed to run transfer cleanup",
      error
    );
  }
}
