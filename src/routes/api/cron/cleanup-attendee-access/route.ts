import { createFileRoute } from "@tanstack/react-router";

import { cleanupExpiredAccessChallenges } from "@/features/attendee-access/access.server";
import { expireTicketOperations } from "@/features/attendee-operations/ticket-operations.server";
import { requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger.server";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "cron");
  if (authError) return authError;
  try {
    const [access, ticketOperations] = await Promise.all([
      cleanupExpiredAccessChallenges(),
      expireTicketOperations(),
    ]);
    log.info("cron.cleanup-attendee-access", "Attendee access cleanup finished", {
      ...access,
      ...ticketOperations,
    });
    return Response.json({
      success: true,
      ...access,
      ticketOperations,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.cleanup-attendee-access",
      "Attendee access cleanup failed",
      error,
    );
  }
}

export const Route = createFileRoute("/api/cron/cleanup-attendee-access")({
  server: { handlers: { GET: ({ request }) => handleGET(request) } },
});
