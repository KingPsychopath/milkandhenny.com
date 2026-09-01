import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { runPitchReminderScheduledJob } from "@/features/system/scheduled-jobs.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger.server";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "cron");
  if (authError) return authError;
  const startedAt = Date.now();
  const requestId = request.headers.get("x-request-id") ?? null;
  try {
    const outcome = await runPitchReminderScheduledJob(true, request.signal);
    if (!outcome.ran) {
      return Response.json({ success: true, skipped: true, timestamp: new Date().toISOString() });
    }
    log.info("cron.send-pitch-reminders", "Pitch reminder run finished", {
      ...outcome.value,
      skipped: false,
      requestId,
      durationMs: Date.now() - startedAt,
    });
    return Response.json({
      success: true,
      skipped: false,
      ...outcome.value,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.send-pitch-reminders",
      "Pitch reminder run failed",
      error,
      { requestId, durationMs: Date.now() - startedAt },
    );
  }
}

export const Route = createFileRoute("/api/cron/send-pitch-reminders")({
  server: { handlers: { GET: ({ request }) => handleGET(request) } },
});
