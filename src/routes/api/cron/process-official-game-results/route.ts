import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { runEventScoringScheduledJob } from "@/features/system/scheduled-jobs.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger.server";

async function handlePOST(request: Request) {
  const authError = await requireAuth(request, "cron");
  if (authError) return authError;
  const startedAt = Date.now();
  try {
    const outcome = await runEventScoringScheduledJob(true, request.signal);
    if (!outcome.ran) {
      return Response.json({ success: true, skipped: true, timestamp: new Date().toISOString() });
    }
    const { outbox, result, scoringTransitions } = outcome.value;
    log.info("cron.official-game-results", "Official game results processed", {
      ...result,
      outbox,
      scoringTransitions,
      skipped: false,
      durationMs: Date.now() - startedAt,
    });
    return Response.json({
      success: true,
      skipped: false,
      outbox,
      scoringTransitions,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "cron.official-game-results",
      "Official game result processing failed",
      error,
      { durationMs: Date.now() - startedAt },
    );
  }
}

export const Route = createFileRoute("/api/cron/process-official-game-results")({
  server: { handlers: { POST: ({ request }) => handlePOST(request) } },
});
