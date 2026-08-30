import { createFileRoute } from "@tanstack/react-router";

import { personalScore } from "@/features/event-scoring/scoring.server";
import { getTicketByCurrentReference } from "@/features/tickets/store.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request, ticketId: string) {
  try {
    const ticket = await getTicketByCurrentReference(ticketId);
    if (!ticket) return Response.json({ error: "Ticket not found" }, { status: 404 });
    const result = await personalScore({ eventSlug: ticket.eventSlug, ticketId: ticket.id });
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
