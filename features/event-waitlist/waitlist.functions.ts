import { createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestIP } from "@tanstack/react-start/server";
import { Effect } from "effect";

import { EventOperationsService } from "@/features/event-operations/event-operations-service.server";
import { runEventsEffect } from "@/features/events/events-runtime.server";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import type { WaitlistScope } from "./types";

function runWaitlist<A>(
  request: Request,
  use: (service: typeof EventOperationsService.Service) => Effect.Effect<A, unknown>,
) {
  return runEventsEffect(
    Effect.gen(function* () {
      return yield* use(yield* EventOperationsService);
    }),
    request.signal,
  );
}

export const requestEventWaitlistFn = createServerFn({ method: "POST" })
  .validator((data: { eventSlug: string; email: string; scope: WaitlistScope }) => data)
  .handler(async ({ data }) => {
    const request = getRequest();
    return runWaitlist(request, (service) =>
      service.requestWaitlist({
        ...data,
        origin: getBaseUrlForRequest(request),
        ip: getRequestIP() || "unknown",
      }),
    );
  });

export const getWaitlistManagementFn = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(({ data }) => {
    const request = getRequest();
    return runWaitlist(request, (service) => service.getWaitlist(data.token));
  });

export const updateWaitlistManagementFn = createServerFn({ method: "POST" })
  .validator((data: { token: string; action: "confirm" | "leave" }) => data)
  .handler(({ data }) => {
    const request = getRequest();
    return runWaitlist(request, (service) =>
      service.updateWaitlist({
        ...data,
        origin: getBaseUrlForRequest(request),
      }),
    );
  });
