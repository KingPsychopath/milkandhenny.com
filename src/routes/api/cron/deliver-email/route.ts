import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { drainEmailOutbox } from "@/lib/platform/email-outbox.server";
import { expandDueCommunicationStages } from "@/features/communications/communication-plans.server";
import { log } from "@/lib/platform/logger.server";

async function handlePOST(request: Request) {
  const authError = await requireAuth(request, "cron");
  if (authError) return authError;
  const startedAt = Date.now();
  const requestId = request.headers.get("x-request-id") ?? null;
  try {
    const staged = await expandDueCommunicationStages(request);
    const handled = await drainEmailOutbox();
    log.info("cron.deliver-email", "Email outbox drain finished", {
      staged,
      handled,
      requestId,
      durationMs: Date.now() - startedAt,
    });
    return Response.json({ success: true, staged, handled, timestamp: new Date().toISOString() });
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
