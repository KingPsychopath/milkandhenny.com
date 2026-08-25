import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { processPendingOfficialGameResults } from "@/features/event-scoring/games.server";
import { processScheduledScoringTransitions } from "@/features/event-scoring/scoring.server";
import { drainOfficialGameResultOutbox } from "@/features/things/shared/official-game-results.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger.server";

async function handlePOST(request: Request) {
  const authError = await requireAuth(request, "cron");
  if (authError) return authError;
  const startedAt = Date.now();
  try {
    const [outbox, result, scoringTransitions] = await Promise.all([
      drainOfficialGameResultOutbox(),
      processPendingOfficialGameResults(),
      processScheduledScoringTransitions(),
    ]);
    log.info("cron.official-game-results", "Official game results processed", {
      ...result,
      outbox,
      scoringTransitions,
      durationMs: Date.now() - startedAt,
    });
    return Response.json({
      success: true,
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
