import { buildEventIcs, buildTicketHolderIcsOptions } from "@/features/events/ics";
import { buildEventUrl, buildTicketUrl } from "@/features/events/routes";
import { getEvent } from "@/features/events/store.server";
import { getTicketByCurrentReference } from "./store.server";

export type TicketCalendarDocument = {
  content: string;
  filename: string;
};

/** Resolve a private calendar only through the ticket's current bearer reference. */
export async function getTicketCalendarDocument(
  id: string,
  origin: string,
): Promise<TicketCalendarDocument | null> {
  const ticket = await getTicketByCurrentReference(id);
  if (!ticket || ticket.status !== "valid") return null;

  const publicTicketId = ticket.accessReference ?? ticket.id;

  const event = await getEvent(ticket.eventSlug);
  if (!event || event.status === "cancelled") return null;

  return {
    content: buildEventIcs(
      event,
      buildTicketHolderIcsOptions(event, {
        eventUrl: buildEventUrl(origin, event.slug),
        ticketUrl: buildTicketUrl(origin, publicTicketId),
      }),
    ),
    filename: `${event.slug}.ics`,
  };
}
