import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { cleanupOrphanWordMediaFolders } from "@/features/words/media-maintenance";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger.server";

export const dynamic = "force-dynamic";

async function handleGET(request: Request) {
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
      staleIncomingCandidates: result.staleIncomingCandidates,
      deletedIncomingObjects: result.deletedIncomingObjects,
      deletedIncomingBytes: result.deletedIncomingBytes,
      r2Configured: result.r2Configured,
    });

    return Response.json({
      success: true,
      ...result,
      durationMs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.cleanup-word-media-orphans",
      "Cron orphan word-media cleanup failed",
      error,
      {
        durationMs: Date.now() - startedAtMs,
      },
    );
  }
}

export const Route = createFileRoute("/api/cron/cleanup-word-media-orphans")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
    },
  },
});
