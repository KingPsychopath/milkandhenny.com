import { buildAppUrl } from "@/lib/shared/app-url";

export function eventsPath() {
  return "/events";
}

export function eventPath(slug: string) {
  return `/events/${slug}`;
}

export function ticketPath(id: string) {
  return `/ticket/${id}`;
}

/**
 * Where Stripe sends someone whose payment went through.
 *
 * A page of its own rather than a flag on the event page: at the moment of
 * the redirect the tickets may not exist yet, so this surface has to be able
 * to say "still confirming" — something a ticket page, which needs a ticket
 * id to exist at all, cannot do.
 */
export function eventBoughtPath(slug: string) {
  return `/events/${slug}/bought`;
}

export function eventIcsPath(slug: string) {
  return `/api/events/${slug}/ics`;
}

/** Calendar entry with the address, door code and a link back to the ticket. */
export function ticketIcsPath(id: string) {
  return `/api/tickets/${id}/ics`;
}

export function buildEventUrl(origin: string, slug: string) {
  return buildAppUrl(origin, eventPath(slug));
}

export function buildEventBoughtUrl(origin: string, slug: string) {
  return buildAppUrl(origin, eventBoughtPath(slug));
}

export function buildTicketUrl(origin: string, id: string) {
  return buildAppUrl(origin, ticketPath(id));
}

export function buildTicketIcsUrl(origin: string, id: string) {
  return buildAppUrl(origin, ticketIcsPath(id));
}
