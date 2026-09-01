import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { EventScoringService } from "@/features/event-scoring/event-scoring-service.server";
import { activeParticipantForEvent } from "@/features/event-scoring/session.server";
import { runEventsResult } from "@/features/events/events-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request, slug: string) {
  try {
    const currentParticipantId = await activeParticipantForEvent(slug);
    const outcome = await runEventsResult(
      Effect.gen(function* () {
        const scoring = yield* EventScoringService;
        return yield* scoring.publicLeaderboard({ eventSlug: slug, currentParticipantId });
      }),
      request.signal,
    );
    if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
    const result = outcome.value;
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result.value, {
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "event-scoring.public-leaderboard",
      "Could not load the leaderboard",
      error,
    );
  }
}

export const Route = createFileRoute("/api/events/$slug/score")({
  server: { handlers: { GET: ({ request, params }) => handleGET(request, params.slug) } },
});
