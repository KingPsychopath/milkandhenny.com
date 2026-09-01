import { Effect } from "effect";
import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { getMediaProcessorMode } from "@/features/media/config.server";
import { MediaWorkerService, runMediaEffect } from "@/features/system/media-worker-runtime.server";
import { getAdminTransferMediaStats } from "@/features/transfers/admin.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger.server";

export const dynamic = "force-dynamic";

async function readMediaStatus() {
  const mode = getMediaProcessorMode();
  const media = await getAdminTransferMediaStats();
  const lastHeartbeatAt = media.worker?.lastHeartbeatAt;

  return {
    mode,
    queueEnabled: mode !== "local",
    queueLength: media.queueLength,
    queue: media.queue,
    heartbeatAgeSeconds: lastHeartbeatAt
      ? Math.max(0, Math.round((Date.now() - new Date(lastHeartbeatAt).getTime()) / 1000))
      : null,
    worker: media.worker,
  };
}

/**
 * GET — queue and worker status, for an external monitor to alert on.
 *
 * The worker drains continuously; it does not need a scheduler to poke it.
 * Alert on a stale heartbeat or a growing backlog.
 */
async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "cron");
  if (authErr) return authErr;

  try {
    return Response.json({ success: true, ...(await readMediaStatus()) });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.transfers.process-media",
      "Failed to inspect transfer media status",
      error,
    );
  }
}

/**
 * POST — reconcile media that never finished.
 *
 * The worker already sweeps for stranded files on its reconciliation timer.
 * This is the backstop for the case that sweep cannot cover: the worker itself
 * being down. Both paths share a Redis lock, so running both is harmless.
 */
async function handlePOST(request: Request) {
  const authErr = await requireAuth(request, "cron");
  if (authErr) return authErr;

  const startedAtMs = Date.now();

  try {
    const result = await runMediaEffect(
      Effect.gen(function* () {
        const media = yield* MediaWorkerService;
        return yield* media.reconcile;
      }),
      request.signal,
    );
    log.info("cron.transfers.process-media", "Reconcile sweep finished", {
      ...result,
      durationMs: Date.now() - startedAtMs,
    });

    return Response.json({
      success: true,
      reconcile: result,
      durationMs: Date.now() - startedAtMs,
      ...(await readMediaStatus()),
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.transfers.process-media",
      "Failed to reconcile transfer media",
      error,
    );
  }
}

export const Route = createFileRoute("/api/cron/process-transfer-media")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      POST: ({ request }) => handlePOST(request),
    },
  },
});

export { handleGET as GET, handlePOST as POST };
