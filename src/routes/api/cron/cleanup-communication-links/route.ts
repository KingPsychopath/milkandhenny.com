import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { requireAuth } from "@/features/auth/auth.server";
import { CommunicationsService } from "@/features/communications/communications-service.server";
import { runEventsEffect } from "@/features/events/events-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger.server";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "cron");
  if (authError) return authError;
  try {
    const result = await runEventsEffect(
      Effect.gen(function* () {
        return yield* (yield* CommunicationsService).cleanupLinks;
      }),
      request.signal,
    );
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
