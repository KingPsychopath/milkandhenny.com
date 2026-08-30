import { createServerFn } from "@tanstack/react-start";

import { openAttendeeTicket } from "@/features/event-scoring/session.server";
import { getTicketByCurrentReference } from "./store.server";

export const useTicketForScoringFn = createServerFn({ method: "POST" })
  .validator((data: { ticketId: string }) => data)
  .handler(async ({ data }) => {
    const ticket = await getTicketByCurrentReference(data.ticketId);
    if (!ticket) return { ok: false as const, status: 404, error: "Ticket not found" };
    const result = await openAttendeeTicket({
      ticketId: data.ticketId,
      eventSlug: ticket.eventSlug,
      mode: "scoring",
    });
    return result
      ? { ok: true as const }
      : { ok: false as const, status: 409, error: "That ticket is not available" };
  });
