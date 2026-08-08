import { createFileRoute } from "@tanstack/react-router";

import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import { getEvent } from "@/features/events/store.server";
import { refundOrder } from "@/features/tickets/checkout.server";
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
  quantity?: unknown;
  notes?: unknown;
  sendEmail?: unknown;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function handlePOST(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  let body: ActionBody;
  try {
    body = (await request.json()) as ActionBody;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const action = asString(body.action);

  try {
    switch (action) {
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
          // Admin comping bypasses the sales window and capacity on purpose:
          // the person is being let in regardless, so the count should say so.
          force: true,
        });
        if (!issued.ok) return Response.json({ error: issued.error }, { status: issued.status });

        let emailed = false;
        if (body.sendEmail !== false && issued.value.tickets.some((ticket) => ticket.email)) {
          const delivery = await sendTicketEmail({
            event: issued.value.event,
            tickets: issued.value.tickets,
            origin: getBaseUrlForRequest(request),
          });
          emailed = delivery.sent;
        }
        return Response.json({
          ok: true,
          ticketIds: issued.value.tickets.map((ticket) => ticket.id),
          emailed,
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
        });
        if (!delivery.sent) {
          return Response.json(
            { error: delivery.error ?? "Email failed to send" },
            { status: 502 },
          );
        }
        return Response.json({ ok: true, sent: live.length });
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
        const result = await refundOrder({ ticketId, reason: "admin" });
        if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
        return Response.json({ ok: true, refunded: result.value.refunded });
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

export const Route = createFileRoute("/api/admin/events/$slug/tickets")({
  server: {
    handlers: {
      POST: ({ request, params }) => handlePOST(request, params.slug),
    },
  },
});
