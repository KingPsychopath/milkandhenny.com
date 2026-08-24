import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { cleanupExpiredCommunicationLinks } from "@/features/communications/email-links.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger.server";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "cron");
  if (authError) return authError;
  try {
    const result = await cleanupExpiredCommunicationLinks();
    log.info("cron.cleanup-communication-links", "Communication link cleanup finished", result);
    return Response.json({ success: true, ...result, timestamp: new Date().toISOString() });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.cleanup-communication-links",
      "Communication link cleanup failed",
      error,
    );
  }
}

export const Route = createFileRoute("/api/cron/cleanup-communication-links")({
  server: { handlers: { GET: ({ request }) => handleGET(request) } },
});
