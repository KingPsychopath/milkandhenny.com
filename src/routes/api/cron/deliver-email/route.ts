import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { runEmailDeliveryScheduledJob } from "@/features/system/scheduled-jobs.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger.server";

async function handlePOST(request: Request) {
  const authError = await requireAuth(request, "cron");
  if (authError) return authError;
  const startedAt = Date.now();
  const requestId = request.headers.get("x-request-id") ?? null;
  try {
    const outcome = await runEmailDeliveryScheduledJob(true, request.signal);
    const { staged, waitlistAlerts, handled } = outcome.ran
      ? outcome.value
      : { staged: 0, waitlistAlerts: 0, handled: 0 };
    log.info("cron.deliver-email", "Email outbox drain finished", {
      staged,
      waitlistAlerts,
      handled,
      skipped: !outcome.ran,
      requestId,
      durationMs: Date.now() - startedAt,
    });
    return Response.json({
      success: true,
      staged,
      waitlistAlerts,
      handled,
      skipped: !outcome.ran,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromRequest(request, "cron.deliver-email", "Email delivery failed", error, {
      requestId,
      durationMs: Date.now() - startedAt,
    });
  }
}

export const Route = createFileRoute("/api/cron/deliver-email")({
  server: { handlers: { POST: ({ request }) => handlePOST(request) } },
});
