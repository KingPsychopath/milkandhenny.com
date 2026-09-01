import type { EventRecord } from "@/features/events/types";

const ACTIVE_EVENT_STATUSES = new Set<EventRecord["status"]>(["published", "sold-out"]);

/** Pick the event an operator is most likely working on right now. */
export function pickDefaultAdminEvent(
  events: readonly EventRecord[],
  now = new Date(),
): EventRecord | undefined {
  const timestamp = now.getTime();
  const active = events.filter((event) => ACTIVE_EVENT_STATUSES.has(event.status));
  const currentOrUpcoming = active
    .filter((event) => {
      const fallbackEnd = new Date(event.startsAt).getTime() + 6 * 60 * 60 * 1_000;
      const end = event.endsAt ? new Date(event.endsAt).getTime() : fallbackEnd;
      return end >= timestamp;
    })
    .toSorted(
      (left, right) =>
        Math.abs(new Date(left.startsAt).getTime() - timestamp) -
        Math.abs(new Date(right.startsAt).getTime() - timestamp),
    );

  if (currentOrUpcoming[0]) return currentOrUpcoming[0];

  const mostRecentActive = active.toSorted(
    (left, right) => new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime(),
  )[0];
  if (mostRecentActive) return mostRecentActive;

  const nextDraft = events
    .filter((event) => event.status === "draft")
    .toSorted(
      (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
    )[0];
  return nextDraft ?? events[0];
}
