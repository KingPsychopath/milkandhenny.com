import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { currentAttendeeEmailAddress } from "@/features/attendee-access/access.server";
import { eventsOperation } from "@/features/events/events-operation.server";
import { readTicketHolderSlugs } from "@/features/tickets/holder-cookie.server";
import { log } from "@/lib/platform/logger.server";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import { getEventPage, type EventPageData } from "./event-page.server";
import { runEventsResult as runEventOperationsResult } from "@/features/events/events-runtime.server";

export type EventPageResult =
  | { found: true; data: EventPageData; origin: string; waitlistEmail?: string }
  | { found: false };

export const getEventPageFn = createServerFn({ method: "GET" })
  .validator((data: { slug: string }) => data)
  .handler(async ({ data }): Promise<EventPageResult> => {
    const request = getRequest();
    const origin = getBaseUrlForRequest(request);
    const revealLocation = readTicketHolderSlugs().includes(data.slug);
    const result = await runEventOperationsResult(
      eventsOperation({ domain: "events", operation: "page" }, () =>
        getEventPage(data.slug, { revealLocation }),
      ),
      request.signal,
    );

    if (!result.ok || !result.value) return { found: false };
    const hasWaitlist =
      result.value.event.waitlistEnabled &&
      (result.value.soldOut ||
        result.value.availability.some((entry) => entry.sales.state === "sold-out"));
    let waitlistEmail: string | undefined;
    if (hasWaitlist) {
      try {
        waitlistEmail = await currentAttendeeEmailAddress();
      } catch (error) {
        log.warn("events.waitlist_prefill", "Could not load the attendee email default", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { found: true, data: result.value, origin, waitlistEmail };
  });
