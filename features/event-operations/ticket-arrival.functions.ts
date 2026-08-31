import { createServerFn } from "@tanstack/react-start";

import { openedTicketForReference } from "@/features/event-scoring/session.server";
import { getEvent } from "@/features/events/store.server";
import { getTicket } from "@/features/tickets/store.server";

export const getTicketArrivalStateFn = createServerFn({ method: "GET" })
  .validator((value: unknown) => {
    const input = value as { ticketReference?: unknown } | null;
    if (typeof input?.ticketReference !== "string" || input.ticketReference.length > 160) {
      throw new Error("Ticket is invalid");
    }
    return { ticketReference: input.ticketReference };
  })
  .handler(async ({ data }) => {
    const access = await openedTicketForReference(data.ticketReference);
    if (!access) return { found: false as const };
    const [ticket, event] = await Promise.all([
      getTicket(access.ticketId),
      getEvent(access.eventSlug),
    ]);
    if (!ticket || !event) return { found: false as const };
    return {
      found: true as const,
      redeemedAt: ticket.redeemedAt,
      arrivalExperience: event.arrivalExperience,
    };
  });
