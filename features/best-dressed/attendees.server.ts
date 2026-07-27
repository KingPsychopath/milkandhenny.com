import { listEvents } from "@/features/events/store.server";
import { isUpcoming } from "@/features/events/types";
import { getTicketHolderNames } from "@/features/tickets/tickets.server";
import { log } from "@/lib/platform/logger.server";

/**
 * Who can be voted for.
 *
 * Best-dressed used to read the standalone guest list, which was a CSV
 * imported once for the first birthday. That list is gone; ticket holders are
 * now the source of truth for who is actually in the room.
 *
 * Best-dressed has no event of its own, so it resolves to the nearest live
 * event: the soonest upcoming one, falling back to the most recent past one
 * so voting still works during and just after a night.
 */
export async function getAttendeeNames(): Promise<string[]> {
  try {
    const events = await listEvents({ limit: 50 });
    if (events.length === 0) return [];

    const upcoming = events
      .filter((event) => isUpcoming(event))
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

    const past = events
      .filter((event) => !isUpcoming(event))
      .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));

    const target = upcoming[0] ?? past[0];
    if (!target) return [];

    return await getTicketHolderNames(target.slug);
  } catch (error) {
    // Voting degrading to "no matches" is better than a 500 mid-party.
    log.error("best-dressed.attendees", "Failed to resolve attendee names", {}, error);
    return [];
  }
}
