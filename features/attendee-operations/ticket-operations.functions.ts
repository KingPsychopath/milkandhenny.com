import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Effect } from "effect";

import { getAttendeeSession } from "@/features/event-scoring/session.server";
import { runEventsEffect } from "@/features/events/events-runtime.server";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import { getTicketByCurrentReference } from "@/features/tickets/store.server";
import { AttendeeOperationsService } from "./attendee-operations-service.server";

async function attendeePersonId() {
  return (await getAttendeeSession())?.personId;
}

function runOperation<A, E>(
  use: (operations: typeof AttendeeOperationsService.Service) => Effect.Effect<A, E>,
) {
  return runEventsEffect(
    Effect.gen(function* () {
      return yield* use(yield* AttendeeOperationsService);
    }),
  );
}

export const sendTicketOperationFn = createServerFn({ method: "POST" })
  .validator(
    (data: { action: "assign" | "transfer"; ticketId: string; recipientEmail: string }) => data,
  )
  .handler(async ({ data }) => {
    const personId = await attendeePersonId();
    if (!personId) return { ok: false as const, status: 401, error: "Verify your email first" };
    const ticket = await getTicketByCurrentReference(data.ticketId);
    if (!ticket) return { ok: false as const, status: 404, error: "Ticket not found" };
    const origin = getBaseUrlForRequest(getRequest());
    return data.action === "assign"
      ? runOperation((operations) =>
          operations.requestAssignment({
            ticketId: ticket.id,
            purchaserPersonId: personId,
            recipientEmail: data.recipientEmail,
            origin,
          }),
        )
      : runOperation((operations) =>
          operations.requestTransfer({
            ticketId: ticket.id,
            senderPersonId: personId,
            recipientEmail: data.recipientEmail,
            origin,
          }),
        );
  });

export const cancelTicketOperationFn = createServerFn({ method: "POST" })
  .validator((data: { kind: "assignment" | "transfer" | "return"; operationId: string }) => data)
  .handler(async ({ data }) => {
    const personId = await attendeePersonId();
    if (!personId) return { ok: false as const, status: 401, error: "Verify your email first" };
    if (data.kind === "return") {
      return runOperation((operations) =>
        operations.cancelReturn({
          returnRequestId: data.operationId,
          actorPersonId: personId,
        }),
      );
    }
    const kind = data.kind;
    return runOperation((operations) =>
      operations.cancelPending({
        kind,
        operationId: data.operationId,
        actorPersonId: personId,
      }),
    );
  });

export const resendTicketOperationFn = createServerFn({ method: "POST" })
  .validator((data: { kind: "assignment" | "transfer"; operationId: string }) => data)
  .handler(async ({ data }) => {
    const personId = await attendeePersonId();
    if (!personId) return { ok: false as const, status: 401, error: "Verify your email first" };
    return runOperation((operations) =>
      operations.resendPending({
        kind: data.kind,
        operationId: data.operationId,
        actorPersonId: personId,
        origin: getBaseUrlForRequest(getRequest()),
      }),
    );
  });
