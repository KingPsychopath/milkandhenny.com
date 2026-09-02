import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { runEventDropsScheduledJob } from "@/features/system/scheduled-jobs.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handlePOST(request: Request) {
  const authError = await requireAuth(request, "cron");
  if (authError) return authError;
  try {
    const outcome = await runEventDropsScheduledJob(true, request.signal);
    return Response.json({
      success: true,
      skipped: !outcome.ran,
      ...(outcome.ran ? outcome.value : {}),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromRequest(request, "cron.event-drops", "Scheduled event drops failed", error);
  }
}

export const Route = createFileRoute("/api/cron/process-event-drops")({
  server: { handlers: { POST: ({ request }) => handlePOST(request) } },
});
