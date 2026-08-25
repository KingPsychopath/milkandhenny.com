import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { cleanupEmailOperations } from "@/features/email-operations/email-operations.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger.server";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "cron");
  if (authError) return authError;
  try {
    const result = await cleanupEmailOperations();
    log.info("cron.cleanup-email", "Email retention cleanup finished", { ...result });
    return Response.json({ success: true, ...result, timestamp: new Date().toISOString() });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.cleanup-email",
      "Email retention cleanup failed",
      error,
    );
  }
}

export const Route = createFileRoute("/api/cron/cleanup-email")({
  server: { handlers: { GET: ({ request }) => handleGET(request) } },
});
