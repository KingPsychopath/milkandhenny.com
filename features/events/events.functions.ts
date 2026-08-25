import { Effect } from "effect";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { authenticateRequest } from "@/features/auth/auth.server";
import { EventsService } from "./events-service.server";
import { runEventsResult } from "./events-runtime.server";
import type { EventsIndexData } from "./events.server";

/**
 * TanStack server-function boundary for events.
 *
 * Routes own coarse authorization; these functions own the Promise/Effect
 * edge and the shape of what reaches the browser.
 */

export const getEventsIndexFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<EventsIndexData> => {
    const result = await runEventsResult(
      Effect.gen(function* () {
        const events = yield* EventsService;
        return yield* events.index();
      }),
    );
    // The index is a shop window: an outage should show an empty shelf, not
    // an error page that makes the whole site look broken.
    return result.ok ? result.value : { upcoming: [], past: [] };
  },
);

export type AdminEventsResult =
  | { authorised: false }
  | { authorised: true; events: Awaited<ReturnType<typeof listForAdmin>> };

async function listForAdmin() {
  const result = await runEventsResult(
    Effect.gen(function* () {
      const events = yield* EventsService;
      return yield* events.list({ includeHidden: true });
    }),
  );
  return result.ok ? result.value : [];
}

export const getAdminEventsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminEventsResult> => {
    const request = getRequest();
    const auth = await authenticateRequest(request, "admin");
    if (!auth.ok) return { authorised: false };
    return { authorised: true, events: await listForAdmin() };
  },
);
