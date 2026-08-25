import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { eventsOperation } from "@/features/events/events-operation.server";
import { readTicketHolderSlugs } from "@/features/tickets/holder-cookie.server";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import { getEventPage, type EventPageData } from "./event-page.server";
import { runEventOperationsResult } from "./runtime.server";

export type EventPageResult =
  | { found: true; data: EventPageData; origin: string }
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
    );

    if (!result.ok || !result.value) return { found: false };
    return { found: true, data: result.value, origin };
  });
