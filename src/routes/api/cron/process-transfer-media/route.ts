import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { getMediaProcessorMode } from "@/features/media/config.server";
import { getAdminTransferMediaStats } from "@/features/transfers/admin.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

export const dynamic = "force-dynamic";

/**
 * Queue observability, not a queue consumer.
 *
 * The media worker drains continuously — it does not need a scheduler to poke
 * it. This endpoint exists so an external monitor can alert on a stale
 * heartbeat or a growing backlog.
 */
async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "cron");
  if (authErr) return authErr;

  try {
    const mode = getMediaProcessorMode();
    const media = await getAdminTransferMediaStats();
    const lastHeartbeatAt = media.worker?.lastHeartbeatAt;
    const heartbeatAgeSeconds = lastHeartbeatAt
      ? Math.max(0, Math.round((Date.now() - new Date(lastHeartbeatAt).getTime()) / 1000))
      : null;

    return Response.json({
      success: true,
      mode,
      queueEnabled: mode !== "local",
      queueLength: media.queueLength,
      heartbeatAgeSeconds,
      worker: media.worker,
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.transfers.process-media",
      "Failed to inspect transfer media status",
      error,
    );
  }
}

export const Route = createFileRoute("/api/cron/process-transfer-media")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
    },
  },
});
