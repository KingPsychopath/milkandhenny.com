import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { EventScoringService } from "@/features/event-scoring/event-scoring-service.server";
import {
  activeParticipantForEvent,
  openAttendeeTicket,
} from "@/features/event-scoring/session.server";
import { runEventsEffect } from "@/features/events/events-runtime.server";

export const Route = createFileRoute("/api/events/$slug/game-results/group-claims")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const body = (await request.json().catch(() => null)) as {
          operation?: unknown;
          token?: unknown;
          ticketId?: unknown;
        } | null;
        if (typeof body?.token !== "string")
          return Response.json({ error: "A team claim token is required" }, { status: 400 });
        const token = body.token;
        if (body.operation === "preview") {
          const result = await runEventsEffect(
            Effect.gen(function* () {
              const scoring = yield* EventScoringService;
              return yield* scoring.readGroupClaim({
                eventSlug: params.slug,
                token,
              });
            }),
            request.signal,
          );
          return result.ok
            ? Response.json(result.value)
            : Response.json({ error: result.error }, { status: result.status });
        }
        if (body.operation === "claim") {
          const ticketId = typeof body.ticketId === "string" ? body.ticketId : undefined;
          const selected = ticketId
            ? await openAttendeeTicket({ ticketId, eventSlug: params.slug, mode: "scoring" })
            : null;
          const participantId =
            selected?.ticket.participantId ?? (await activeParticipantForEvent(params.slug));
          if (!participantId)
            return Response.json(
              {
                error: "Open your event ticket on this phone, then scan the team code again.",
              },
              { status: 401 },
            );
          const result = await runEventsEffect(
            Effect.gen(function* () {
              const scoring = yield* EventScoringService;
              return yield* scoring.claimGroupResult({
                eventSlug: params.slug,
                token,
                targetParticipantId: participantId,
              });
            }),
            request.signal,
          );
          return result.ok
            ? Response.json(result.value)
            : Response.json({ error: result.error }, { status: result.status });
        }
        return Response.json({ error: "Invalid claim operation" }, { status: 400 });
      },
    },
  },
});
