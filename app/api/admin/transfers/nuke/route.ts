import { NextRequest, NextResponse } from "next/server";
import { requireAdminStepUp, requireAuth } from "@/features/auth/server";
import { getRedis } from "@/lib/platform/redis";
import { isConfigured, listObjects, deleteObjects } from "@/lib/platform/r2";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

/**
 * Hard reset for transfers: deletes all transfer files + transfer metadata.
 * Admin-only and intentionally destructive.
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
    // Delete all files under transfers/
    const objects = await listObjects("transfers/");
    const keys = objects.map((o) => o.key);
    const deletedFiles = keys.length > 0 ? await deleteObjects(keys) : 0;

    // Delete all transfer metadata keys + index
    const indexedIds: string[] = await redis.smembers("transfer:index");
    const pipeline = redis.pipeline();
    for (const id of indexedIds) {
      pipeline.del(`transfer:${id}`);
    }
    pipeline.del("transfer:index");
    await pipeline.exec();

    return NextResponse.json({
      success: true,
      deletedFiles,
      deletedTransfers: indexedIds.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.transfers.nuke", "Failed to nuke transfers", error);
  }
}
