import { Effect } from "effect";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { EventOperationsService } from "@/features/event-operations/event-operations-service.server";
import { runEventsEffect } from "@/features/events/events-runtime.server";

export const getAdminWaitlistFn = createServerFn({ method: "GET" })
  .validator((data: { eventSlug: string }) => ({ eventSlug: data.eventSlug.trim().slice(0, 160) }))
  .handler(async ({ data }) => {
    const request = getRequest();
    const access = await getAdminWorkspaceAccess(request);
    if (!access.ok || !access.permissions.viewOperations)
      throw new Error("Event operations access required");
    return runEventsEffect(
      Effect.gen(function* () {
        return yield* (yield* EventOperationsService).listWaitlist(data.eventSlug);
      }),
      request.signal,
    );
  });
