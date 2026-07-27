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

export function eventIcsPath(slug: string) {
  return `/api/events/${slug}/ics`;
}

export function buildEventUrl(origin: string, slug: string) {
  return buildAppUrl(origin, eventPath(slug));
}

export function buildTicketUrl(origin: string, id: string) {
  return buildAppUrl(origin, ticketPath(id));
}
