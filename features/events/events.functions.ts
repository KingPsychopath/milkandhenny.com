import { Effect } from "effect";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import {
  getEventsIndex,
  type EventsIndexData,
} from "@/features/event-operations/events-index.server";
import { eventsOperation } from "./events-operation.server";
import { EventsService } from "./events-service.server";
import { runEventsResult } from "./events-runtime.server";

/**
 * TanStack server-function boundary for events.
 *
 * Routes own coarse authorization; these functions own the Promise/Effect
 * edge and the shape of what reaches the browser.
 */

export const getEventsIndexFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<EventsIndexData> => {
    const result = await runEventsResult(
      eventsOperation({ domain: "events", operation: "index" }, () => getEventsIndex()),
      getRequest().signal,
    );
    // The index is a shop window: an outage should show an empty shelf, not
    // an error page that makes the whole site look broken.
    return result.ok ? result.value : { upcoming: [], past: [] };
  },
);

async function listForAdmin() {
  const result = await runEventsResult(
    Effect.gen(function* () {
      const events = yield* EventsService;
      return yield* events.list({ includeHidden: true });
    }),
    getRequest().signal,
  );
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

export const getAdminEventsFn = createServerFn({ method: "GET" }).handler(async () => {
  const access = await getAdminWorkspaceAccess(getRequest());
  if (!access.ok || !access.permissions.viewOperations)
    throw new Error("Event operations access required");
  return listForAdmin();
});
