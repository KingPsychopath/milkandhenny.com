import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { runOperationsDigestScheduledJob } from "@/features/system/scheduled-jobs.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handlePOST(request: Request) {
  const auth = await requireAuth(request, "cron");
  if (auth) return auth;
  try {
    const outcome = await runOperationsDigestScheduledJob(true, request.signal);
    return Response.json(
      outcome.ran
        ? { success: true, schedulerSkipped: false, ...outcome.value }
        : { success: true, schedulerSkipped: true },
    );
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.operations-digests",
      "Operations digests could not be sent",
      error,
    );
  }
}

export const Route = createFileRoute("/api/cron/send-operations-digests")({
  server: { handlers: { POST: ({ request }) => handlePOST(request) } },
});
