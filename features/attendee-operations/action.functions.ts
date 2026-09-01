import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Effect } from "effect";

import { runEventsEffect } from "@/features/events/events-runtime.server";
import { inspectAccessAction } from "./access-grants.server";
import { AttendeeOperationsService } from "./attendee-operations-service.server";
import { inspectTicketAction } from "./ticket-operations.server";

function runAction<A, E>(
  use: (operations: typeof AttendeeOperationsService.Service) => Effect.Effect<A, E>,
) {
  return runEventsEffect(
    Effect.gen(function* () {
      return yield* use(yield* AttendeeOperationsService);
    }),
    getRequest().signal,
  );
}

export const readAttendeeActionFn = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const ticket = await inspectTicketAction(data.token);
    if (ticket) return { kind: "ticket" as const, ...ticket };
    const access = await inspectAccessAction(data.token);
    return access ? { kind: "access" as const, ...access } : null;
  });

export const acceptAttendeeActionFn = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const access = await inspectAccessAction(data.token);
    if (access) return runAction((operations) => operations.acceptAccess(data.token));
    const ticket = await inspectTicketAction(data.token);
    return ticket?.purpose === "refund-consent" || ticket?.purpose === "ticket-return"
      ? runAction((operations) => operations.acceptRefund(data.token))
      : runAction((operations) => operations.acceptTicket(data.token));
  });

export const declineAttendeeActionFn = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const ticket = await inspectTicketAction(data.token);
    return ticket?.purpose === "refund-consent" || ticket?.purpose === "ticket-return"
      ? runAction((operations) => operations.declineRefund(data.token))
      : runAction((operations) => operations.declineTransfer(data.token));
  });
