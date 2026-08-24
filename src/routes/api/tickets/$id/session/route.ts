import { createFileRoute } from "@tanstack/react-router";

import {
  getAttendeeSession,
  openAttendeeTicket,
  removeTicketFromDevice,
  setActiveParticipant,
} from "@/features/event-scoring/session.server";
import { getTicket } from "@/features/tickets/store.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handlePOST(request: Request, ticketId: string) {
  try {
    const ticket = await getTicket(ticketId);
    if (!ticket) return Response.json({ error: "Ticket not found" }, { status: 404 });
    const body: unknown = await request.json().catch(() => null);
    const record =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const mode =
      record.mode === "personal" || record.mode === "managed" || record.mode === "view-only"
        ? record.mode
        : "view-only";
    const result = await openAttendeeTicket({ ticketId, eventSlug: ticket.eventSlug, mode });
    if (!result) return Response.json({ error: "That ticket is not available" }, { status: 409 });
    return Response.json({
      session: result.session,
      activeParticipantId: result.session.activeParticipantByEventId[result.ticket.eventId],
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

async function handlePATCH(request: Request, ticketId: string) {
  try {
    const ticket = await getTicket(ticketId);
    const session = await getAttendeeSession();
    const entry = session?.tickets.find((candidate) => candidate.ticketId === ticketId);
    if (!ticket || !session || !entry)
      return Response.json({ error: "Ticket is not open on this device" }, { status: 404 });
    const result = await setActiveParticipant({
      eventSlug: ticket.eventSlug,
      participantId: entry.participantId,
    });
    return result
      ? Response.json({ session: result })
      : Response.json({ error: "Ticket is not available" }, { status: 409 });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "event-scoring.session.select",
      "Could not select the ticket",
      error,
    );
  }
}

async function handleDELETE(request: Request, ticketId: string) {
  try {
    return Response.json({ removed: await removeTicketFromDevice(ticketId) });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "event-scoring.session.remove",
      "Could not remove the ticket from this device",
      error,
    );
  }
}

export const Route = createFileRoute("/api/tickets/$id/session")({
  server: {
    handlers: {
      POST: ({ request, params }) => handlePOST(request, params.id),
      PATCH: ({ request, params }) => handlePATCH(request, params.id),
      DELETE: ({ request, params }) => handleDELETE(request, params.id),
    },
  },
});
