import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { EventScoringService } from "@/features/event-scoring/event-scoring-service.server";
import { runEventsResult } from "@/features/events/events-runtime.server";
import { getTicketByCurrentReference } from "@/features/tickets/store.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request, ticketId: string) {
  try {
    const ticket = await getTicketByCurrentReference(ticketId);
    if (!ticket) return Response.json({ error: "Ticket not found" }, { status: 404 });
    const outcome = await runEventsResult(
      Effect.gen(function* () {
        const scoring = yield* EventScoringService;
        return yield* scoring.personalScore({ eventSlug: ticket.eventSlug, ticketId: ticket.id });
      }),
      request.signal,
    );
    if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
    const result = outcome.value;
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result.value, {
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "event-scoring.personal-score",
      "Could not load the score",
      error,
    );
  }
}

export const Route = createFileRoute("/api/tickets/$id/score")({
  server: { handlers: { GET: ({ request, params }) => handleGET(request, params.id) } },
});
