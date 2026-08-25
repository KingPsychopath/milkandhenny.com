import { listEvents } from "@/features/events/store.server";
import { isUpcoming, toPublicEvent, type PublicEvent } from "@/features/events/types";
import { getTicketCapacitySnapshots } from "@/features/tickets/capacity.server";
import { buildAvailability, isEventSoldOut } from "./event-page.server";

export type EventsIndexItem = PublicEvent & { soldOut: boolean };

export type EventsIndexData = {
  upcoming: EventsIndexItem[];
  past: EventsIndexItem[];
};

/** Public event list composed with the same capacity truth as each detail page. */
export async function getEventsIndex(now = Date.now()): Promise<EventsIndexData> {
  const events = await listEvents();
  const snapshots = await getTicketCapacitySnapshots(events.map((event) => event.slug));
  const upcoming: EventsIndexItem[] = [];
  const past: EventsIndexItem[] = [];

  events.forEach((event) => {
    const availability = buildAvailability(event, snapshots[event.slug], now);
    const item = { ...toPublicEvent(event), soldOut: isEventSoldOut(event, availability) };
    (isUpcoming(event, now) ? upcoming : past).push(item);
  });

  upcoming.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  past.sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  return { upcoming, past };
}
