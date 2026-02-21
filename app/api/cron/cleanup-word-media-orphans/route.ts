import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { cleanupOrphanWordMediaFolders } from "@/features/words/media-maintenance";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request, "cron");
  if (authErr) return authErr;

  const startedAtMs = Date.now();
  const requestId = request.headers.get("x-request-id") ?? null;

  try {
    const result = await cleanupOrphanWordMediaFolders();
    const durationMs = Date.now() - startedAtMs;

    log.info("cron.cleanup-word-media-orphans", "Cron orphan word-media cleanup finished", {
      requestId,
      durationMs,
      scannedFolders: result.scannedFolders,
      linkedWords: result.linkedWords,
      orphanFolders: result.orphanFolders,
      deletedFolders: result.deletedFolders,
      deletedObjects: result.deletedObjects,
      deletedBytes: result.deletedBytes,
      r2Configured: result.r2Configured,
    });

    return NextResponse.json({
      success: true,
      ...result,
      durationMs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromRequest(request, "cron.cleanup-word-media-orphans", "Cron orphan word-media cleanup failed", error, {
      durationMs: Date.now() - startedAtMs,
    });
  }
}

