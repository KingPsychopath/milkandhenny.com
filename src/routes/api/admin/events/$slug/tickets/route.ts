import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { AttendeeOperationsService } from "@/features/attendee-operations/attendee-operations-service.server";
import { requireAdminStepUp, requireAuthWithPayload } from "@/features/auth/auth.server";
import { EventOperationsService } from "@/features/event-operations/event-operations-service.server";
import { runEventsResult } from "@/features/events/events-runtime.server";
import { TicketsService } from "@/features/tickets/tickets-service.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import { listAdminTicketInvitations } from "@/features/attendee-operations/ticket-operations.server";
import { updateTicketHolder } from "@/features/tickets/store.server";
import { getTicket } from "@/features/tickets/tickets.server";
import { isValidTicketId } from "@/features/tickets/types";
import { isValidEmail } from "@/lib/shared/email-address";

/**
 * Admin ticket operations for one event.
 *
 * One POST endpoint, action-dispatched: the panel is the only caller and a
 * REST resource per verb would be ceremony. Money-adjacent actions (refund,
 * void) additionally require step-up; comping and resending do not, because
 * they are how the door actually gets run on the night.
 */

type ActionBody = {
  action?: unknown;
  ticketId?: unknown;
  holderName?: unknown;
  email?: unknown;
  ticketTypeId?: unknown;
  targetTicketTypeId?: unknown;
  quantity?: unknown;
  notes?: unknown;
  sendEmail?: unknown;
  overrideCapacity?: unknown;
  invitationId?: unknown;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function runTicket<A, E>(
  request: Request,
  use: (tickets: typeof TicketsService.Service) => Effect.Effect<A, E>,
) {
  return runEventsResult(
    Effect.gen(function* () {
      return yield* use(yield* TicketsService);
    }),
    request.signal,
  );
}

function runAttendee<A, E>(
  request: Request,
  use: (operations: typeof AttendeeOperationsService.Service) => Effect.Effect<A, E>,
) {
  return runEventsResult(
    Effect.gen(function* () {
      return yield* use(yield* AttendeeOperationsService);
    }),
    request.signal,
  );
}

function runOperation<A, E>(
  request: Request,
  use: (operations: typeof EventOperationsService.Service) => Effect.Effect<A, E>,
) {
  return runEventsResult(
    Effect.gen(function* () {
      return yield* use(yield* EventOperationsService);
    }),
    request.signal,
  );
}

async function handlePOST(request: Request, slug: string) {
  const auth = await requireAuthWithPayload(request, "admin");
  if (auth.error) return auth.error;

  let body: ActionBody;
  try {
    body = (await request.json()) as ActionBody;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const action = asString(body.action);
  const actorType = auth.actorType === "admin" ? "admin" : "root-owner";
  const actorId = auth.actorId ?? "root-owner";

  try {
    switch (action) {
      case "invite": {
        const holderName = asString(body.holderName);
        const email = asString(body.email);
        const ticketTypeId = asString(body.ticketTypeId);
        if (!holderName || !email || !ticketTypeId) {
          return Response.json(
            { error: "A name, email address, and ticket type are required" },
            { status: 400 },
          );
        }
        const invitationOutcome = await runOperation(request, (operations) =>
          operations.inviteTicket({
            eventSlug: slug,
            holderName,
            email,
            ticketTypeId,
            bypassCapacity: body.overrideCapacity === true,
            actorType,
            actorId,
            origin: getBaseUrlForRequest(request),
          }),
        );
        if (!invitationOutcome.ok) {
          return Response.json(
            { error: invitationOutcome.error },
            { status: invitationOutcome.status },
          );
        }
        const invitation = invitationOutcome.value;
        if (!invitation.ok)
          return Response.json({ error: invitation.error }, { status: invitation.status });
        return Response.json({ ok: true, ...invitation.value });
      }

      case "cancel-invitation": {
        const stepUpErr = await requireAdminStepUp(request);
        if (stepUpErr) return stepUpErr;
        const invitationId = asString(body.invitationId);
        if (!invitationId) {
          return Response.json({ error: "Invitation not found" }, { status: 400 });
        }
        const outcome = await runAttendee(request, (operations) =>
          operations.cancelInvitation({ eventSlug: slug, invitationId, actorType, actorId }),
        );
        if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
        const result = outcome.value;
        if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
        return Response.json({ ok: true });
      }

      case "resend-invitation": {
        const invitationId = asString(body.invitationId);
        if (!invitationId) {
          return Response.json({ error: "Invitation not found" }, { status: 400 });
        }
        const outcome = await runAttendee(request, (operations) =>
          operations.resendInvitation({
            eventSlug: slug,
            invitationId,
            actorType,
            actorId,
            origin: getBaseUrlForRequest(request),
          }),
        );
        if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
        const result = outcome.value;
        if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
        return Response.json({ ok: true, ...result.value });
      }

      case "comp": {
        const holderName = asString(body.holderName);
        const ticketTypeId = asString(body.ticketTypeId);
        const quantity = typeof body.quantity === "number" ? body.quantity : 1;
        if (!holderName || !ticketTypeId) {
          return Response.json({ error: "A name and ticket type are required" }, { status: 400 });
        }

        const issueOutcome = await runOperation(request, (operations) =>
          operations.issueComp({
            issue: {
              eventSlug: slug,
              ticketTypeId,
              holderName,
              email: asString(body.email),
              quantity,
              kind: "comp",
              notes: asString(body.notes),
              // Door staff may issue outside the public sales window. Exceeding
              // capacity remains a separate, explicit operator decision.
              bypassSalesWindow: true,
              bypassCapacity: body.overrideCapacity === true,
            },
            notify: body.sendEmail !== false,
            origin: getBaseUrlForRequest(request),
          }),
        );
        if (!issueOutcome.ok)
          return Response.json({ error: issueOutcome.error }, { status: issueOutcome.status });
        const issued = issueOutcome.value;
        if (!issued.ok) return Response.json({ error: issued.error }, { status: issued.status });

        return Response.json({
          ok: true,
          ticketIds: issued.value.ticketIds,
          emailQueued: issued.value.emailQueued,
        });
      }

      case "resend": {
        const ticketId = asString(body.ticketId);
        if (!ticketId || !isValidTicketId(ticketId)) {
          return Response.json({ error: "Unknown ticket" }, { status: 400 });
        }
        const outcome = await runOperation(request, (operations) =>
          operations.resendTicketOrder({
            eventSlug: slug,
            ticketId,
            origin: getBaseUrlForRequest(request),
          }),
        );
        if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
        const result = outcome.value;
        if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
        return Response.json({
          ok: true,
          ...result.value,
        });
      }

      case "refund": {
        const stepUpErr = await requireAdminStepUp(request);
        if (stepUpErr) return stepUpErr;

        const ticketId = asString(body.ticketId);
        if (!ticketId || !isValidTicketId(ticketId)) {
          return Response.json({ error: "Unknown ticket" }, { status: 400 });
        }
        const ticket = await getTicket(ticketId);
        if (!ticket || ticket.eventSlug !== slug) {
          return Response.json({ error: "Ticket not found" }, { status: 404 });
        }
        const outcome = await runEventsResult(
          Effect.gen(function* () {
            const operations = yield* EventOperationsService;
            return yield* operations.refundTicket({
              ticketId,
              reason: "admin",
              actorId: auth.actorId ?? "root-owner",
            });
          }),
          request.signal,
        );
        if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
        const result = outcome.value;
        if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
        return Response.json({
          ok: true,
          state: result.value.state,
          refunded: result.value.refunded,
          emailQueued: result.value.emailQueued,
        });
      }

      case "exchange": {
        const stepUpErr = await requireAdminStepUp(request);
        if (stepUpErr) return stepUpErr;

        const ticketId = asString(body.ticketId);
        const targetTicketTypeId = asString(body.targetTicketTypeId);
        if (!ticketId || !isValidTicketId(ticketId) || !targetTicketTypeId) {
          return Response.json(
            { error: "A ticket and new ticket type are required" },
            { status: 400 },
          );
        }
        const ticket = await getTicket(ticketId);
        if (!ticket || ticket.eventSlug !== slug) {
          return Response.json({ error: "Ticket not found" }, { status: 404 });
        }
        const outcome = await runEventsResult(
          Effect.gen(function* () {
            const operations = yield* EventOperationsService;
            return yield* operations.startExchange({
              ticketId,
              targetTicketTypeId,
              actorType: "admin",
              origin: getBaseUrlForRequest(request),
            });
          }),
          request.signal,
        );
        if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
        const result = outcome.value;
        if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
        return Response.json({ ok: true, ...result.value });
      }

      case "void": {
        const stepUpErr = await requireAdminStepUp(request);
        if (stepUpErr) return stepUpErr;

        const ticketId = asString(body.ticketId);
        if (!ticketId || !isValidTicketId(ticketId)) {
          return Response.json({ error: "Unknown ticket" }, { status: 400 });
        }
        const ticket = await getTicket(ticketId);
        if (!ticket || ticket.eventSlug !== slug) {
          return Response.json({ error: "Ticket not found" }, { status: 404 });
        }
        const outcome = await runTicket(request, (tickets) => tickets.void(ticketId));
        if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
        const result = outcome.value;
        if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
        return Response.json({ ok: true });
      }

      case "unredeem": {
        const ticketId = asString(body.ticketId);
        if (!ticketId || !isValidTicketId(ticketId)) {
          return Response.json({ error: "Unknown ticket" }, { status: 400 });
        }
        const ticket = await getTicket(ticketId);
        if (!ticket || ticket.eventSlug !== slug) {
          return Response.json({ error: "Ticket not found" }, { status: 404 });
        }
        const outcome = await runTicket(request, (tickets) => tickets.unredeem(ticketId));
        if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
        const result = outcome.value;
        if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
        return Response.json({ ok: true });
      }

      case "update": {
        const ticketId = asString(body.ticketId);
        if (!ticketId || !isValidTicketId(ticketId)) {
          return Response.json({ error: "Unknown ticket" }, { status: 400 });
        }
        const ticket = await getTicket(ticketId);
        if (!ticket || ticket.eventSlug !== slug) {
          return Response.json({ error: "Ticket not found" }, { status: 404 });
        }

        const holderName = asString(body.holderName);
        const rawEmail = body.email;
        // `email: ""` clears the address; absent leaves it untouched.
        const email =
          rawEmail === "" ? null : typeof rawEmail === "string" ? rawEmail.trim() : undefined;
        if (email && !isValidEmail(email)) {
          return Response.json({ error: "That email address doesn't look right" }, { status: 400 });
        }
        if (!holderName && email === undefined) {
          return Response.json({ error: "Nothing to change" }, { status: 400 });
        }

        const updated = await updateTicketHolder(ticketId, {
          holderName,
          email: email === undefined ? undefined : email,
        });
        if (!updated) return Response.json({ error: "Ticket not found" }, { status: 404 });
        return Response.json({ ok: true, ticket: { id: updated.id } });
      }

      case "redeem": {
        const ticketId = asString(body.ticketId);
        if (!ticketId || !isValidTicketId(ticketId)) {
          return Response.json({ error: "Unknown ticket" }, { status: 400 });
        }
        const result = await runTicket(request, (tickets) =>
          tickets.redeem({
            scanned: ticketId,
            eventSlug: slug,
            redeemedBy: "admin",
          }),
        );
        if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
        return Response.json({ ok: result.value.result === "admitted", outcome: result.value });
      }

      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return apiErrorFromRequest(request, "events.admin.tickets", "Ticket action failed", error);
  }
}

async function handleGET(request: Request, slug: string) {
  const authErr = await requireAuthWithPayload(request, "admin");
  if (authErr.error) return authErr.error;
  try {
    return Response.json({ invitations: await listAdminTicketInvitations(slug) });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "events.admin.ticket-invitations",
      "Failed to load ticket invitations",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/events/$slug/tickets")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, params.slug),
      POST: ({ request, params }) => handlePOST(request, params.slug),
    },
  },
});
