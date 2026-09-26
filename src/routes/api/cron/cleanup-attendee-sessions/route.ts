import { createFileRoute } from "@tanstack/react-router";

import { cleanupPostgresAttendeeSessions } from "@/features/attendee-access/session-postgres.server";
import { cleanupPostgresPasskeyCeremonies } from "@/features/attendee-access/passkey-ceremony-postgres.server";
import { requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger.server";
import { withOperationSignal } from "@/lib/platform/operation-context.server";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "cron");
  if (authError) return authError;
  try {
    const { removed, ceremoniesRemoved } = await withOperationSignal(request.signal, async () => {
      const [removed, ceremoniesRemoved] = await Promise.all([
        cleanupPostgresAttendeeSessions(),
        cleanupPostgresPasskeyCeremonies(),
      ]);
      return { removed, ceremoniesRemoved };
    });
    log.info("cron.cleanup-attendee-sessions", "Expired attendee auth state removed", {
      removed,
      ceremoniesRemoved,
    });
    return Response.json({
      success: true,
      removed,
      ceremoniesRemoved,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.cleanup-attendee-sessions",
      "Attendee session cleanup failed",
      error,
    );
  }
}

export const Route = createFileRoute("/api/cron/cleanup-attendee-sessions")({
  server: { handlers: { GET: ({ request }) => handleGET(request) } },
});
