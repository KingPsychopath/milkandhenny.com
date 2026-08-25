import { createFileRoute } from "@tanstack/react-router";

import {
  cancelPendingTicketOperation,
  cancelTransferredTicketReturn,
  requestTicketAssignment,
  requestTicketTransfer,
  resendPendingTicketOperation,
  ticketOperationsForPerson,
} from "@/features/attendee-operations/ticket-operations.server";
import { getAttendeeSession } from "@/features/event-scoring/session.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function attendee() {
  const session = await getAttendeeSession();
  return session?.personId ? session : null;
}

async function handleGET(request: Request) {
  try {
    const session = await attendee();
    if (!session?.personId)
      return Response.json({ error: "Verify your email first" }, { status: 401 });
    return Response.json({ operations: await ticketOperationsForPerson(session.personId) });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "attendee-operations.list",
      "Could not load ticket actions",
      error,
    );
  }
}

async function handlePOST(request: Request) {
  try {
    const session = await attendee();
    if (!session?.personId)
      return Response.json({ error: "Verify your email first" }, { status: 401 });
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
      ticketId?: unknown;
      recipientEmail?: unknown;
      kind?: unknown;
      operationId?: unknown;
    } | null;
    if (!body) return Response.json({ error: "Ticket action is required" }, { status: 400 });
    const origin = new URL(request.url).origin;
    if (
      body.action === "resend" &&
      (body.kind === "assignment" || body.kind === "transfer") &&
      typeof body.operationId === "string"
    ) {
      const result = await resendPendingTicketOperation({
        kind: body.kind,
        operationId: body.operationId,
        actorPersonId: session.personId,
        origin,
      });
      return result.ok
        ? Response.json(result.value)
        : Response.json({ error: result.error }, { status: result.status });
    }
    if (typeof body.ticketId !== "string" || typeof body.recipientEmail !== "string") {
      return Response.json({ error: "Ticket and recipient email are required" }, { status: 400 });
    }
    const result =
      body.action === "assign"
        ? await requestTicketAssignment({
            ticketId: body.ticketId,
            purchaserPersonId: session.personId,
            recipientEmail: body.recipientEmail,
            origin,
          })
        : body.action === "transfer"
          ? await requestTicketTransfer({
              ticketId: body.ticketId,
              senderPersonId: session.personId,
              recipientEmail: body.recipientEmail,
              origin,
            })
          : null;
    if (!result) return Response.json({ error: "Unknown ticket action" }, { status: 400 });
    return result.ok
      ? Response.json(result.value, { status: 201 })
      : Response.json({ error: result.error }, { status: result.status });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "attendee-operations.request",
      "Could not create ticket action",
      error,
    );
  }
}

async function handleDELETE(request: Request) {
  try {
    const session = await attendee();
    if (!session?.personId)
      return Response.json({ error: "Verify your email first" }, { status: 401 });
    const body = (await request.json().catch(() => null)) as {
      kind?: unknown;
      operationId?: unknown;
    } | null;
    if (
      !body ||
      (body.kind !== "assignment" && body.kind !== "transfer" && body.kind !== "return") ||
      typeof body.operationId !== "string"
    ) {
      return Response.json({ error: "Operation is required" }, { status: 400 });
    }
    const result =
      body.kind === "return"
        ? await cancelTransferredTicketReturn({
            returnRequestId: body.operationId,
            actorPersonId: session.personId,
          })
        : await cancelPendingTicketOperation({
            kind: body.kind,
            operationId: body.operationId,
            actorPersonId: session.personId,
          });
    return result.ok
      ? Response.json(result.value)
      : Response.json({ error: result.error }, { status: result.status });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "attendee-operations.cancel",
      "Could not cancel ticket action",
      error,
    );
  }
}

export const Route = createFileRoute("/api/attendee/ticket-operations")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      POST: ({ request }) => handlePOST(request),
      DELETE: ({ request }) => handleDELETE(request),
    },
  },
});
