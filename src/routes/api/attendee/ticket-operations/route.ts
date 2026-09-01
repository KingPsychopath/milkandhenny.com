import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { AttendeeOperationsService } from "@/features/attendee-operations/attendee-operations-service.server";
import { ticketOperationsForPerson } from "@/features/attendee-operations/ticket-operations.server";
import { getAttendeeSession } from "@/features/event-scoring/session.server";
import { runEventsEffect } from "@/features/events/events-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function attendee() {
  const session = await getAttendeeSession();
  return session?.personId ? session : null;
}

function runOperation<A, E>(
  request: Request,
  use: (operations: typeof AttendeeOperationsService.Service) => Effect.Effect<A, E>,
) {
  return runEventsEffect(
    Effect.gen(function* () {
      return yield* use(yield* AttendeeOperationsService);
    }),
    request.signal,
  );
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
      const kind = body.kind;
      const operationId = body.operationId;
      const actorPersonId = session.personId;
      const result = await runOperation(request, (operations) =>
        operations.resendPending({
          kind,
          operationId,
          actorPersonId,
          origin,
        }),
      );
      return result.ok
        ? Response.json(result.value)
        : Response.json({ error: result.error }, { status: result.status });
    }
    if (typeof body.ticketId !== "string" || typeof body.recipientEmail !== "string") {
      return Response.json({ error: "Ticket and recipient email are required" }, { status: 400 });
    }
    const ticketId = body.ticketId;
    const recipientEmail = body.recipientEmail;
    const actorPersonId = session.personId;
    const result =
      body.action === "assign"
        ? await runOperation(request, (operations) =>
            operations.requestAssignment({
              ticketId,
              purchaserPersonId: actorPersonId,
              recipientEmail,
              origin,
            }),
          )
        : body.action === "transfer"
          ? await runOperation(request, (operations) =>
              operations.requestTransfer({
                ticketId,
                senderPersonId: actorPersonId,
                recipientEmail,
                origin,
              }),
            )
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
    const operationId = body.operationId;
    const actorPersonId = session.personId;
    let result;
    if (body.kind === "return") {
      result = await runOperation(request, (operations) =>
        operations.cancelReturn({ returnRequestId: operationId, actorPersonId }),
      );
    } else {
      const kind = body.kind;
      result = await runOperation(request, (operations) =>
        operations.cancelPending({ kind, operationId, actorPersonId }),
      );
    }
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
