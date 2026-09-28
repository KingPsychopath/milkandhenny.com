import { queryOptions } from "@tanstack/react-query";
import { getAdminEventsFn, getEventsIndexFn } from "./events.functions";
import { getEventPageFn } from "@/features/event-operations/event-page.functions";

export const eventsIndexQuery = queryOptions({
  queryKey: ["events", "public", "index"] as const,
  queryFn: () => getEventsIndexFn(),
  staleTime: 15_000,
});

/** Private admin event catalogue; identity transitions clear this entry. */
export const adminEventsQuery = queryOptions({
  queryKey: ["admin", "events", "catalogue"] as const,
  queryFn: () => getAdminEventsFn(),
  staleTime: 10_000,
  retry: false,
});

/** The page can include attendee-specific fields; clear it on every identity transition. */
export function eventPageQuery(slug: string) {
  return queryOptions({
    queryKey: ["events", slug, "viewer-page"] as const,
    queryFn: () => getEventPageFn({ data: { slug } }),
    staleTime: 5_000,
  });
}
