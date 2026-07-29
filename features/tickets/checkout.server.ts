import { randomBytes } from "node:crypto";

import { log } from "@/lib/platform/logger.server";
import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import {
  createCheckoutSession,
  isPaymentsConfigured,
  refundPayment,
  retrieveSession,
} from "@/lib/platform/stripe.server";
import { getEvent } from "@/features/events/store.server";
import { ticketTypeSalesState } from "@/features/events/types";
import { buildEventUrl, ticketPath } from "@/features/events/routes";
import { getSoldCounts, listTicketsForOrder, markOrderRefunded } from "./store.server";
import { hashEmail, isTicketSigningConfigured } from "./qr.server";
import { issueTickets, type TicketOpResult } from "./tickets.server";
import { sendTicketEmail } from "./email.server";
import { isValidEmail, normaliseEmail, type TicketRecord } from "./types";

/**
 * Paid ticket purchase.
 *
 * The webhook issues tickets, not the success redirect — people close the
 * tab, and a ticket that exists only because a browser came back is a ticket
 * that sometimes does not exist. `checkout_sessions` is the idempotency
 * ledger: Stripe may deliver the same event more than once, and only the
 * transaction that flips a row out of `pending` gets to issue.
 */

export type StartCheckoutInput = {
  eventSlug: string;
  ticketTypeId: string;
  holderName: string;
  email: string;
  quantity: number;
  origin: string;
};

export type StartCheckoutResult = TicketOpResult<{ url: string; sessionId: string }>;

export async function startCheckout(input: StartCheckoutInput): Promise<StartCheckoutResult> {
  if (!isPaymentsConfigured()) {
    return { ok: false, status: 503, error: "Payments are not configured" };
  }
  if (!isTicketSigningConfigured()) {
    return { ok: false, status: 503, error: "Ticketing is not configured" };
  }

  const holderName = input.holderName?.trim();
  if (!holderName) return { ok: false, status: 400, error: "A name is required" };
  if (!isValidEmail(input.email)) {
    return { ok: false, status: 400, error: "That email address doesn't look right" };
  }

  const quantity = Math.round(input.quantity);
  if (!Number.isFinite(quantity) || quantity < 1) {
    return { ok: false, status: 400, error: "Choose at least one ticket" };
  }

  const event = await getEvent(input.eventSlug);
  if (!event) return { ok: false, status: 404, error: "Event not found" };

  const ticketType = event.ticketTypes.find((type) => type.id === input.ticketTypeId);
  if (!ticketType) return { ok: false, status: 404, error: "Ticket type not found" };
  if (ticketType.priceMinor <= 0) {
    return { ok: false, status: 400, error: "This ticket is free — no payment needed" };
  }
  if (quantity > ticketType.perPersonLimit) {
    return {
      ok: false,
      status: 409,
      error: `Limit of ${ticketType.perPersonLimit} per person for ${ticketType.name}`,
    };
  }

  const sold = await getSoldCounts(event.slug);
  const sales = ticketTypeSalesState(event, ticketType, sold[ticketType.id] ?? 0);
  if (sales.state !== "on-sale") {
    return { ok: false, status: 409, error: "These tickets aren't on sale right now" };
  }

  const remaining = Math.max(0, ticketType.quantity - (sold[ticketType.id] ?? 0));
  if (quantity > remaining) {
    return {
      ok: false,
      status: 409,
      error: remaining === 0 ? "Sold out" : `Only ${remaining} left`,
    };
  }

  const email = normaliseEmail(input.email);
  const reference = randomBytes(16).toString("base64url");
  const amountMinor = ticketType.priceMinor * quantity;

  let session: { id: string; url: string };
  try {
    session = await createCheckoutSession({
      eventTitle: event.title,
      ticketTypeName: ticketType.name,
      priceMinor: ticketType.priceMinor,
      currency: ticketType.currency,
      quantity,
      email,
      successUrl: `${buildEventUrl(input.origin, event.slug)}?checkout=success`,
      cancelUrl: `${buildEventUrl(input.origin, event.slug)}?checkout=cancelled`,
      reference,
      metadata: {
        eventSlug: event.slug,
        ticketTypeId: ticketType.id,
        holderName,
        quantity: String(quantity),
      },
    });
  } catch (error) {
    log.error("checkout.create", "Stripe session creation failed", { slug: event.slug }, error);
    return { ok: false, status: 502, error: "Could not start checkout. Try again." };
  }

  await query(
    `insert into checkout_sessions (
       id, event_slug, ticket_type_id, quantity, holder_name, email, email_hash,
       amount_minor, currency, status
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
     on conflict (id) do nothing`,
    [
      session.id,
      event.slug,
      ticketType.id,
      quantity,
      holderName,
      email,
      hashEmail(email),
      amountMinor,
      ticketType.currency,
    ],
  );

  return { ok: true, value: { url: session.url, sessionId: session.id } };
}

type CheckoutRow = {
  id: string;
  event_slug: string;
  ticket_type_id: string;
  quantity: number;
  holder_name: string;
  email: string;
  amount_minor: number;
  currency: string;
};

export type FulfilResult =
  | { outcome: "issued"; tickets: TicketRecord[] }
  | { outcome: "already-issued" }
  | { outcome: "unknown-session" }
  | { outcome: "refunded-oversold" }
  | { outcome: "failed"; error: string };

/**
 * Issue the tickets for a paid session. Safe to call repeatedly.
 *
 * Capacity is re-checked here rather than held at checkout time. Holding
 * seats would mean abandoned baskets block a small room for half an hour; the
 * trade is that a rare oversell race ends in an automatic refund rather than
 * a person being quietly turned away at the door.
 */
export async function expireCheckout(sessionId: string): Promise<void> {
  await query(
    `update checkout_sessions set status = 'expired' where id = $1 and status = 'pending'`,
    [sessionId],
  );
}

export async function fulfilCheckout(sessionId: string, origin: string): Promise<FulfilResult> {
  // Only the transaction that moves the row out of `pending` proceeds, so a
  // redelivered webhook cannot issue a second set of tickets.
  const claimed = await transaction(async (client) => {
    const { rows } = await client.query<CheckoutRow>(
      `update checkout_sessions
          set status = 'fulfilling'
        where id = $1 and status = 'pending'
        returning id, event_slug, ticket_type_id, quantity, holder_name, email,
                  amount_minor, currency`,
      [sessionId],
    );
    return rows[0] ?? null;
  });

  if (!claimed) {
    const existing = await queryOne<{ status: string }>(
      `select status from checkout_sessions where id = $1`,
      [sessionId],
    );
    if (!existing) return { outcome: "unknown-session" };
    return { outcome: "already-issued" };
  }

  const session = await retrieveSession(sessionId);
  if (!session?.paid) {
    await query(`update checkout_sessions set status = 'pending' where id = $1`, [sessionId]);
    return { outcome: "failed", error: "Session is not paid" };
  }

  const issued = await issueTickets({
    eventSlug: claimed.event_slug,
    ticketTypeId: claimed.ticket_type_id,
    holderName: claimed.holder_name,
    email: claimed.email,
    quantity: claimed.quantity,
    kind: "paid",
    paymentRef: session.paymentIntentId ?? undefined,
    checkoutRef: sessionId,
    // Per ticket, not the order total: the refund UI shows this figure, and
    // partial refunds are settled by summing what each ticket actually cost.
    amountPaidMinor: Math.round(claimed.amount_minor / Math.max(1, claimed.quantity)),
    currency: claimed.currency,
  });

  if (!issued.ok) {
    // Sold out between paying and fulfilling. Give the money back rather than
    // hold it for an event they cannot attend.
    log.error("checkout.fulfil", "Issuance failed after payment; refunding", {
      sessionId,
      reason: issued.error,
    });

    if (session.paymentIntentId) {
      await refundPayment({
        paymentIntentId: session.paymentIntentId,
        reference: `oversold:${sessionId}`,
      });
    }
    await query(`update checkout_sessions set status = 'refunded' where id = $1`, [sessionId]);
    return { outcome: "refunded-oversold" };
  }

  await query(
    `update checkout_sessions set status = 'fulfilled', fulfilled_at = now(), order_id = $2
      where id = $1`,
    [sessionId, issued.value.orderId],
  );

  // Delivery failure must not fail fulfilment — the tickets exist and the
  // resend flow can recover them.
  await sendTicketEmail({ event: issued.value.event, tickets: issued.value.tickets, origin });

  log.info("checkout.fulfil", "Paid tickets issued", {
    sessionId,
    slug: claimed.event_slug,
    count: issued.value.tickets.length,
  });

  return { outcome: "issued", tickets: issued.value.tickets };
}

export type SelfRefundResult = TicketOpResult<{ refunded: number }>;

/**
 * Refund an order at the buyer's request.
 *
 * Refuses once any ticket in the order has been scanned: the door record is
 * the evidence that they turned up, and refunding after entry is a dispute
 * to have with a human, not a button.
 */
export async function refundOrder(input: {
  ticketId: string;
  reason: "self-serve" | "admin";
}): Promise<SelfRefundResult> {
  const anchor = await queryOne<{
    order_id: string;
    payment_ref: string | null;
    event_slug: string;
  }>(`select order_id, payment_ref, event_slug from tickets where id = $1`, [input.ticketId]);

  if (!anchor) return { ok: false, status: 404, error: "Ticket not found" };
  if (!anchor.payment_ref) {
    return { ok: false, status: 400, error: "This ticket was not paid for" };
  }

  const tickets = await listTicketsForOrder(anchor.order_id);
  if (tickets.some((ticket) => ticket.redeemedAt)) {
    return {
      ok: false,
      status: 409,
      error: "Someone on this order has already checked in — message us and we'll sort it.",
    };
  }
  if (tickets.every((ticket) => ticket.status === "refunded")) {
    return { ok: true, value: { refunded: 0 } };
  }

  const refund = await refundPayment({
    paymentIntentId: anchor.payment_ref,
    reference: `order:${anchor.order_id}`,
  });
  if (!refund.ok) return { ok: false, status: 502, error: refund.error };

  const updated = await markOrderRefunded(anchor.payment_ref, refund.refundId);
  log.info("checkout.refund", "Order refunded", {
    orderId: anchor.order_id,
    count: updated.length,
    reason: input.reason,
  });

  return { ok: true, value: { refunded: updated.length } };
}

export { ticketPath };
