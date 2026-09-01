import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { EventScoringService } from "@/features/event-scoring/event-scoring-service.server";
import { activeParticipantForEvent } from "@/features/event-scoring/session.server";
import { runEventsEffect } from "@/features/events/events-runtime.server";

export const Route = createFileRoute("/api/events/$slug/game-results/claim")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const participantId = await activeParticipantForEvent(params.slug);
        if (!participantId)
          return Response.json({ error: "Open your ticket first" }, { status: 401 });
        const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
        if (typeof body?.token !== "string") {
          return Response.json({ error: "A game result claim token is required" }, { status: 400 });
        }
        const token = body.token;
        const result = await runEventsEffect(
          Effect.gen(function* () {
            const scoring = yield* EventScoringService;
            return yield* scoring.claimGameResult({
              token,
              targetParticipantId: participantId,
            });
          }),
          request.signal,
        );
        return result.ok
          ? Response.json(result.value)
          : Response.json({ error: result.error }, { status: result.status });
      },
    },
  },
});
