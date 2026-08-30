import { createFileRoute } from "@tanstack/react-router";

import { openAttendeeTicket, ticketPointSelection } from "@/features/event-scoring/session.server";
import { getTicketByCurrentReference } from "@/features/tickets/store.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request, ticketId: string) {
  try {
    return Response.json(await ticketPointSelection(ticketId));
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "event-scoring.session.read",
      "Could not read this device’s ticket choice",
      error,
    );
  }
}

async function handlePOST(request: Request, ticketId: string) {
  try {
    const ticket = await getTicketByCurrentReference(ticketId);
    if (!ticket) return Response.json({ error: "Ticket not found" }, { status: 404 });
    const body: unknown = await request.json().catch(() => null);
    const record =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const mode = record.mode === "scoring" ? "scoring" : "view-only";
    const result = await openAttendeeTicket({ ticketId, eventSlug: ticket.eventSlug, mode });
    if (!result) return Response.json({ error: "That ticket is not available" }, { status: 409 });
    return Response.json({
      tickets: result.session.tickets.map((entry) => ({
        ticketId: entry.ticketId,
        eventSlug: entry.eventSlug,
        mode: entry.mode,
      })),
      active:
        result.session.activeParticipantByEventId[result.ticket.eventId] ===
        result.ticket.participantId,
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "event-scoring.session.open",
      "Could not open the ticket on this device",
      error,
    );
  }
}

export const Route = createFileRoute("/api/tickets/$id/session")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, params.id),
      POST: ({ request, params }) => handlePOST(request, params.id),
    },
  },
});
