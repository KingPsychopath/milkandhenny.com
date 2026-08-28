import { createFileRoute } from "@tanstack/react-router";

import { requireAdminStepUp, requireAuthWithPayload } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import { getEvent } from "@/features/events/store.server";
import {
  cancelAdminTicketInvitation,
  createAdminTicketInvitation,
  listAdminTicketInvitations,
  resendAdminTicketInvitation,
} from "@/features/attendee-operations/ticket-operations.server";
import { refundTicket } from "@/features/tickets/checkout.server";
import { beginTicketExchange } from "@/features/tickets/exchange.server";
import { sendTicketEmail } from "@/features/tickets/email.server";
import { listTicketsForOrder, updateTicketHolder } from "@/features/tickets/store.server";
import {
  getTicket,
  issueTickets,
  redeemTicket,
  unredeemTicket,
  voidTicket,
} from "@/features/tickets/tickets.server";
import { isValidEmail, isValidTicketId } from "@/features/tickets/types";

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
        const issued = await issueTickets({
          eventSlug: slug,
          ticketTypeId,
          holderName,
          email,
          quantity: 1,
          kind: "comp",
          bypassSalesWindow: true,
          bypassCapacity: body.overrideCapacity === true,
        });
        if (!issued.ok) return Response.json({ error: issued.error }, { status: issued.status });
        const ticket = issued.value.tickets[0];
        const invitation = await createAdminTicketInvitation({
          eventSlug: slug,
          ticketId: ticket.id,
          recipientEmail: email,
          actorType,
          actorId,
          origin: getBaseUrlForRequest(request),
        });
        if (!invitation.ok) {
          await voidTicket(ticket.id);
          return Response.json({ error: invitation.error }, { status: invitation.status });
        }
        return Response.json({ ok: true, ticketId: ticket.id, ...invitation.value });
      }

      case "cancel-invitation": {
        const stepUpErr = await requireAdminStepUp(request);
        if (stepUpErr) return stepUpErr;
        const invitationId = asString(body.invitationId);
        if (!invitationId) {
          return Response.json({ error: "Invitation not found" }, { status: 400 });
        }
        const result = await cancelAdminTicketInvitation({
          eventSlug: slug,
          invitationId,
          actorType,
          actorId,
        });
        if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
        return Response.json({ ok: true });
      }

      case "resend-invitation": {
        const invitationId = asString(body.invitationId);
        if (!invitationId) {
          return Response.json({ error: "Invitation not found" }, { status: 400 });
        }
        const result = await resendAdminTicketInvitation({
          eventSlug: slug,
          invitationId,
          actorType,
          actorId,
          origin: getBaseUrlForRequest(request),
        });
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

        const issued = await issueTickets({
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
        });
        if (!issued.ok) return Response.json({ error: issued.error }, { status: issued.status });

        let emailQueued = false;
        if (body.sendEmail !== false && issued.value.tickets.some((ticket) => ticket.email)) {
          const delivery = await sendTicketEmail({
            event: issued.value.event,
            tickets: issued.value.tickets,
            origin: getBaseUrlForRequest(request),
            idempotencyKey: `tickets:issued:${issued.value.orderId}`,
            kind: "ticket-issued",
            source: "admin",
          });
          emailQueued = delivery.queued;
        }
        return Response.json({
          ok: true,
          ticketIds: issued.value.tickets.map((ticket) => ticket.id),
          emailQueued,
        });
      }

      case "resend": {
        const ticketId = asString(body.ticketId);
        if (!ticketId || !isValidTicketId(ticketId)) {
          return Response.json({ error: "Unknown ticket" }, { status: 400 });
        }
        const ticket = await getTicket(ticketId);
        if (!ticket || ticket.eventSlug !== slug) {
          return Response.json({ error: "Ticket not found" }, { status: 404 });
        }
        const [event, orderTickets] = await Promise.all([
          getEvent(slug),
          listTicketsForOrder(ticket.orderId),
        ]);
        if (!event) return Response.json({ error: "Event not found" }, { status: 404 });

        const live = orderTickets.filter((entry) => entry.status === "valid");
        if (live.length === 0) {
          return Response.json({ error: "No live tickets on this order" }, { status: 409 });
        }
        const delivery = await sendTicketEmail({
          event,
          tickets: live,
          origin: getBaseUrlForRequest(request),
          idempotencyKey: `tickets:admin-resend:${ticket.orderId}:${Math.floor(Date.now() / 60_000)}`,
          kind: "ticket-resend",
          source: "admin",
        });
        if (!delivery.queued) {
          return Response.json(
            { error: delivery.error ?? "Email failed to send" },
            { status: 502 },
          );
        }
        return Response.json({
          ok: true,
          queued: delivery.alreadyRequested ? 0 : live.length,
          alreadyRequested: delivery.alreadyRequested === true,
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
        const result = await refundTicket({
          ticketId,
          reason: "admin",
          actorId: auth.actorId ?? "root-owner",
        });
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
        const result = await beginTicketExchange({
          ticketId,
          targetTicketTypeId,
          actorType: "admin",
          origin: getBaseUrlForRequest(request),
        });
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
        const result = await voidTicket(ticketId);
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
        const result = await unredeemTicket(ticketId);
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
        const outcome = await redeemTicket({
          scanned: ticketId,
          eventSlug: slug,
          redeemedBy: "admin",
        });
        return Response.json({ ok: outcome.result === "admitted", outcome });
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
