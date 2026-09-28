import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger.server";
import { withOperationSignal } from "@/lib/platform/operation-context.server";
import { cleanupRateLimitWindows } from "@/lib/platform/rate-limit.server";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "cron");
  if (authError) return authError;
  try {
    const result = await withOperationSignal(request.signal, () => cleanupRateLimitWindows());
    log.info("cron.cleanup-rate-limits", "Expired rate-limit windows removed", result);
    return Response.json({ success: true, ...result, timestamp: new Date().toISOString() });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.cleanup-rate-limits",
      "Rate-limit cleanup failed",
      error,
    );
  }
}

export const Route = createFileRoute("/api/cron/cleanup-rate-limits")({
  server: { handlers: { GET: ({ request }) => handleGET(request) } },
});
