import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { getAttendeeSession } from "@/features/event-scoring/session.server";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import { getTicketByCurrentReference } from "@/features/tickets/store.server";
import {
  cancelPendingTicketOperation,
  cancelTransferredTicketReturn,
  requestTicketAssignment,
  requestTicketTransfer,
  resendPendingTicketOperation,
} from "./ticket-operations.server";

async function attendeePersonId() {
  return (await getAttendeeSession())?.personId;
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
      ? requestTicketAssignment({
          ticketId: ticket.id,
          purchaserPersonId: personId,
          recipientEmail: data.recipientEmail,
          origin,
        })
      : requestTicketTransfer({
          ticketId: ticket.id,
          senderPersonId: personId,
          recipientEmail: data.recipientEmail,
          origin,
        });
  });

export const cancelTicketOperationFn = createServerFn({ method: "POST" })
  .validator((data: { kind: "assignment" | "transfer" | "return"; operationId: string }) => data)
  .handler(async ({ data }) => {
    const personId = await attendeePersonId();
    if (!personId) return { ok: false as const, status: 401, error: "Verify your email first" };
    return data.kind === "return"
      ? cancelTransferredTicketReturn({
          returnRequestId: data.operationId,
          actorPersonId: personId,
        })
      : cancelPendingTicketOperation({
          kind: data.kind,
          operationId: data.operationId,
          actorPersonId: personId,
        });
  });

export const resendTicketOperationFn = createServerFn({ method: "POST" })
  .validator((data: { kind: "assignment" | "transfer"; operationId: string }) => data)
  .handler(async ({ data }) => {
    const personId = await attendeePersonId();
    if (!personId) return { ok: false as const, status: 401, error: "Verify your email first" };
    return resendPendingTicketOperation({
      kind: data.kind,
      operationId: data.operationId,
      actorPersonId: personId,
      origin: getBaseUrlForRequest(getRequest()),
    });
  });
