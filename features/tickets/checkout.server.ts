import { randomBytes } from "node:crypto";

import { log } from "@/lib/platform/logger.server";
import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import {
  createCheckoutSession,
  isPaymentsConfigured,
  listPaymentRefunds,
  refundPayment,
  retrieveSession,
} from "@/lib/platform/stripe.server";
import { getEvent } from "@/features/events/store.server";
import { formatMoney, ticketTypeSalesState, type EventRecord } from "@/features/events/types";
import { buildEventBoughtUrl, buildEventUrl, ticketPath } from "@/features/events/routes";
import {
  getSoldCounts,
  listRefundedTicketsForPayment,
  listTicketsForCheckout,
  listTicketsForOrder,
  markOrderRefunded,
  markOrderRefundPending,
} from "./store.server";
import { hashEmail, isTicketSigningConfigured } from "./qr.server";
import { issueTickets, type TicketOpResult } from "./tickets.server";
import { sendRefundEmail, sendTicketEmail } from "./email.server";
import { getCheckoutMinimumMinor, isCheckoutTotalSupported } from "./payment-limits";
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
  acceptedTerms: boolean;
  checkoutRequestId?: string;
};

export type StartCheckoutResult = TicketOpResult<{ url: string; sessionId: string }>;

export async function startCheckout(input: StartCheckoutInput): Promise<StartCheckoutResult> {
  if (!isPaymentsConfigured()) {
    return { ok: false, status: 503, error: "Payments are not configured" };
  }
  if (!isTicketSigningConfigured()) {
    return { ok: false, status: 503, error: "Ticketing is not configured" };
  }
  if (input.acceptedTerms !== true) {
    return { ok: false, status: 400, error: "Agree to the ticket terms before checkout" };
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
  const eventRemaining =
    event.capacity === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(
          0,
          event.capacity - Object.values(sold).reduce((total, count) => total + count, 0),
        );
  const available = Math.min(remaining, eventRemaining);
  if (quantity > available) {
    return {
      ok: false,
      status: 409,
      error: available === 0 ? "Sold out" : `Only ${available} left`,
    };
  }

  const email = normaliseEmail(input.email);
  const reference =
    input.checkoutRequestId && /^[A-Za-z0-9_-]{16,64}$/.test(input.checkoutRequestId)
      ? input.checkoutRequestId
      : randomBytes(16).toString("base64url");
  const amountMinor = ticketType.priceMinor * quantity;
  if (!isCheckoutTotalSupported(ticketType.priceMinor, quantity, ticketType.currency)) {
    const minimum = getCheckoutMinimumMinor(ticketType.currency);
    return {
      ok: false,
      status: 409,
      error: minimum
        ? `Online payments must total at least ${formatMoney(minimum, ticketType.currency)}`
        : "That payment total is too low",
    };
  }

  let session: { id: string; url: string };
  try {
    session = await createCheckoutSession({
      eventTitle: event.title,
      ticketTypeName: ticketType.name,
      priceMinor: ticketType.priceMinor,
      currency: ticketType.currency,
      quantity,
      email,
      // The brace template is Stripe's, substituted on the redirect. Built by
      // concatenation rather than URLSearchParams, which would percent-encode
      // the braces and hand back a literal `{CHECKOUT_SESSION_ID}`.
      successUrl: `${buildEventBoughtUrl(input.origin, event.slug)}?session={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${buildEventUrl(input.origin, event.slug)}?checkout=cancelled`,
      reference,
      metadata: {
        checkoutReference: reference,
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
       amount_minor, currency, reference, status, terms_accepted_at, terms_snapshot
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',now(),$11::jsonb)
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
      reference,
      JSON.stringify({
        eventTerms: event.terms ?? null,
        refundPolicy: event.refundPolicy ?? null,
        transferable: event.transferable,
      }),
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
  reference: string | null;
};

export type FulfilResult =
  | { outcome: "issued"; tickets: TicketRecord[] }
  | { outcome: "already-issued" }
  | { outcome: "unknown-session" }
  | { outcome: "cancelled"; status: string }
  | { outcome: "awaiting-payment" }
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
    `update checkout_sessions
        set status = 'expired', updated_at = now()
      where id = $1 and status = 'pending'`,
    [sessionId],
  );
}

type CheckoutPaymentStateRow = {
  id: string;
  amount_minor: number;
  status: string;
};

async function findCheckoutForPayment(
  paymentIntentId: string,
  reference?: string,
): Promise<CheckoutPaymentStateRow | null> {
  return queryOne<CheckoutPaymentStateRow>(
    `select id, amount_minor, status
       from checkout_sessions
      where payment_ref = $1
         or (payment_ref is null and $2::text is not null and reference = $2)
      order by created_at desc
      limit 1`,
    [paymentIntentId, reference ?? null],
  );
}

/**
 * Record a refund that arrived before checkout fulfilment.
 *
 * Stripe does not guarantee webhook order. If somebody refunds a payment in
 * Workbench while the checkout event is delayed, cancel the local checkout
 * and refund any remainder instead of issuing tickets later.
 */
export async function cancelUnfulfilledCheckout(input: {
  paymentIntentId: string;
  reference?: string;
  amountRefundedMinor: number;
}): Promise<boolean> {
  const checkout = await findCheckoutForPayment(input.paymentIntentId, input.reference);
  if (!checkout || checkout.status === "fulfilled") return false;

  const remaining = Math.max(0, checkout.amount_minor - input.amountRefundedMinor);
  const refund =
    remaining > 0
      ? await refundPayment({
          paymentIntentId: input.paymentIntentId,
          amountMinor: remaining,
          reference: `pre-fulfil:${checkout.id}:${remaining}`,
        })
      : null;
  if (refund && !refund.ok) throw new Error(refund.error);
  if (refund && (refund.status === "failed" || refund.status === "canceled")) {
    throw new Error("Stripe could not process the remaining refund");
  }

  const status = remaining === 0 || refund?.status === "succeeded" ? "refunded" : "refund_pending";
  await query(
    `update checkout_sessions
        set payment_ref = $2, status = $3,
            refund_ref = coalesce($4, refund_ref),
            processing_started_at = null, updated_at = now()
      where id = $1 and status <> 'fulfilled'`,
    [checkout.id, input.paymentIntentId, status, refund?.refundId ?? null],
  );
  return true;
}

export async function markUnfulfilledCheckoutDisputed(input: {
  paymentIntentId: string;
  reference?: string;
  disputeId: string;
}): Promise<boolean> {
  const checkout = await findCheckoutForPayment(input.paymentIntentId, input.reference);
  if (!checkout || checkout.status === "fulfilled") return false;
  await query(
    `update checkout_sessions
        set payment_ref = $2, status = 'disputed', refund_ref = $3,
            processing_started_at = null, updated_at = now()
      where id = $1 and status <> 'fulfilled'`,
    [checkout.id, input.paymentIntentId, input.disputeId],
  );
  return true;
}

export async function reopenWonDisputeCheckout(
  paymentIntentId: string,
  disputeId: string,
): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `update checkout_sessions
        set status = 'pending', refund_ref = null, updated_at = now()
      where payment_ref = $1 and status = 'disputed' and refund_ref = $2
      returning id`,
    [paymentIntentId, disputeId],
  );
  return row?.id ?? null;
}

/** Reconcile successful Stripe refunds to tickets from Stripe's full history. */
export async function reconcilePaymentRefunds(
  paymentIntentId: string,
  authoritativeAmountMinor = 0,
): Promise<{
  amountRefundedMinor: number;
  tickets: TicketRecord[];
}> {
  const refunds = await listPaymentRefunds(paymentIntentId);
  const succeeded = refunds.filter((refund) => refund.status === "succeeded");
  const amountRefundedMinor = Math.max(
    authoritativeAmountMinor,
    succeeded.reduce((sum, refund) => sum + refund.amountMinor, 0),
  );
  if (amountRefundedMinor === 0) return { amountRefundedMinor, tickets: [] };

  const refundRef = succeeded.at(-1)?.id ?? paymentIntentId;
  const tickets = await markOrderRefunded(paymentIntentId, refundRef, amountRefundedMinor);
  const confirmationTickets =
    tickets.length > 0 ? tickets : await listRefundedTicketsForPayment(paymentIntentId, refundRef);
  if (confirmationTickets.length > 0) {
    const event = await getEvent(confirmationTickets[0].eventSlug);
    if (event) await sendRefundEmail({ event, tickets: confirmationTickets });
  }
  return { amountRefundedMinor, tickets };
}

export async function updateCheckoutRefundStatus(
  refundId: string,
  status: string | null,
): Promise<void> {
  if (status !== "succeeded" && status !== "failed" && status !== "canceled") return;
  await query(
    `update checkout_sessions
        set status = $2, updated_at = now()
      where refund_ref = $1 and status in ('refund_pending', 'refund_failed')`,
    [refundId, status === "succeeded" ? "refunded" : "refund_failed"],
  );
}

export async function fulfilCheckout(sessionId: string, origin: string): Promise<FulfilResult> {
  // Only the transaction that moves the row out of `pending` proceeds, so a
  // redelivered webhook cannot issue a second set of tickets.
  const claimed = await transaction(async (client) => {
    const { rows } = await client.query<CheckoutRow>(
      `update checkout_sessions
          set status = 'fulfilling', processing_started_at = now(), updated_at = now()
        where id = $1
          and (
            status = 'pending'
            or (status = 'fulfilling' and processing_started_at < now() - interval '2 minutes')
          )
        returning id, event_slug, ticket_type_id, quantity, holder_name, email,
                  amount_minor, currency, reference`,
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
    if (existing.status === "fulfilled") {
      const tickets = await listTicketsForCheckout(sessionId);
      if (tickets.length > 0) {
        const event = await getEvent(tickets[0].eventSlug);
        if (event)
          await sendTicketEmail({
            event,
            tickets,
            origin,
            idempotencyKey: `tickets:issued:${tickets[0].orderId}`,
          });
      }
      return { outcome: "already-issued" };
    }
    if (["expired", "refunded", "refund_pending", "disputed"].includes(existing.status)) {
      return { outcome: "cancelled", status: existing.status };
    }
    return { outcome: "failed", error: `Checkout is ${existing.status}` };
  }

  const session = await retrieveSession(sessionId);
  if (!session?.paid) {
    await query(
      `update checkout_sessions
          set status = 'pending', processing_started_at = null, updated_at = now()
        where id = $1`,
      [sessionId],
    );
    return session
      ? { outcome: "awaiting-payment" }
      : { outcome: "failed", error: "Session could not be retrieved" };
  }

  const expectedCurrency = claimed.currency.toLowerCase();
  if (
    session.amountMinor !== claimed.amount_minor ||
    session.currency?.toLowerCase() !== expectedCurrency ||
    (claimed.reference && session.metadata.checkoutReference !== claimed.reference)
  ) {
    await query(
      `update checkout_sessions
          set status = 'payment_mismatch', processing_started_at = null, updated_at = now()
        where id = $1`,
      [sessionId],
    );
    log.error("checkout.fulfil", "Paid session does not match the checkout ledger", {
      sessionId,
    });
    return { outcome: "failed", error: "Paid session values do not match checkout" };
  }

  if (!session.paymentIntentId) {
    await query(
      `update checkout_sessions
          set status = 'pending', processing_started_at = null, updated_at = now()
        where id = $1`,
      [sessionId],
    );
    return { outcome: "failed", error: "Paid session has no PaymentIntent" };
  }

  await query(`update checkout_sessions set payment_ref = $2, updated_at = now() where id = $1`, [
    sessionId,
    session.paymentIntentId,
  ]);

  if (session.disputed) {
    await query(
      `update checkout_sessions
          set status = 'disputed', processing_started_at = null, updated_at = now()
        where id = $1`,
      [sessionId],
    );
    return { outcome: "cancelled", status: "disputed" };
  }

  if (session.amountRefundedMinor > 0) {
    const remaining = Math.max(0, claimed.amount_minor - session.amountRefundedMinor);
    const refund =
      remaining > 0
        ? await refundPayment({
            paymentIntentId: session.paymentIntentId,
            amountMinor: remaining,
            reference: `pre-fulfil:${sessionId}:${remaining}`,
          })
        : null;
    if (refund && !refund.ok) {
      await query(
        `update checkout_sessions
            set status = 'pending', processing_started_at = null, updated_at = now()
          where id = $1`,
        [sessionId],
      );
      return { outcome: "failed", error: refund.error };
    }
    if (refund && (refund.status === "failed" || refund.status === "canceled")) {
      await query(
        `update checkout_sessions
            set status = 'pending', processing_started_at = null, updated_at = now()
          where id = $1`,
        [sessionId],
      );
      return { outcome: "failed", error: "Stripe could not process the remaining refund" };
    }
    const refundRef = refund?.refundId ?? null;
    const status =
      refund?.status === "succeeded" || remaining === 0 ? "refunded" : "refund_pending";
    await query(
      `update checkout_sessions
          set status = $2, refund_ref = coalesce($3, refund_ref),
              processing_started_at = null, updated_at = now()
        where id = $1`,
      [sessionId, status, refundRef],
    );
    return { outcome: "refunded-oversold" };
  }

  // A worker can stop after the ticket transaction commits but before the
  // checkout ledger is updated. Recover that state instead of attempting a
  // second issuance, which could refund a buyer who already has tickets.
  const recoveredTickets = await listTicketsForCheckout(sessionId);
  if (recoveredTickets.length > 0) {
    const orderId = recoveredTickets[0].orderId;
    await query(
      `update checkout_sessions
          set status = 'fulfilled', fulfilled_at = coalesce(fulfilled_at, now()), order_id = $2,
              processing_started_at = null, updated_at = now()
        where id = $1`,
      [sessionId, orderId],
    );
    const event = await getEvent(claimed.event_slug);
    if (event)
      await sendTicketEmail({
        event,
        tickets: recoveredTickets,
        origin,
        idempotencyKey: `tickets:issued:${orderId}`,
      });
    log.info("checkout.fulfil", "Recovered tickets after interrupted fulfilment", {
      sessionId,
      count: recoveredTickets.length,
    });
    return { outcome: "already-issued" };
  }

  let issued;
  try {
    issued = await issueTickets({
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
  } catch (error) {
    // An unexpected throw (not a refusal) must release the claim, or the row
    // is stuck in `fulfilling` and Stripe's retry would read "already-issued"
    // — money kept, no tickets, forever.
    await query(
      `update checkout_sessions
          set status = 'pending', processing_started_at = null, updated_at = now()
        where id = $1 and status = 'fulfilling'`,
      [sessionId],
    );
    throw error;
  }

  if (!issued.ok) {
    // Sold out between paying and fulfilling. Give the money back rather than
    // hold it for an event they cannot attend.
    log.error("checkout.fulfil", "Issuance failed after payment; refunding", {
      sessionId,
      reason: issued.error,
    });

    const refund = await refundPayment({
      paymentIntentId: session.paymentIntentId,
      reference: `oversold:${sessionId}`,
    });
    if (!refund.ok) {
      await query(
        `update checkout_sessions
            set status = 'pending', processing_started_at = null, updated_at = now()
          where id = $1`,
        [sessionId],
      );
      return { outcome: "failed", error: refund.error };
    }
    if (refund.status === "failed" || refund.status === "canceled") {
      await query(
        `update checkout_sessions
            set status = 'pending', processing_started_at = null, updated_at = now()
          where id = $1`,
        [sessionId],
      );
      return { outcome: "failed", error: "Stripe could not process the refund" };
    }
    await query(
      `update checkout_sessions
          set status = $2, refund_ref = $3, processing_started_at = null, updated_at = now()
        where id = $1`,
      [sessionId, refund.status === "succeeded" ? "refunded" : "refund_pending", refund.refundId],
    );
    return { outcome: "refunded-oversold" };
  }

  await query(
    `update checkout_sessions
        set status = 'fulfilled', fulfilled_at = now(), order_id = $2,
            processing_started_at = null, updated_at = now()
      where id = $1`,
    [sessionId, issued.value.orderId],
  );

  // Delivery failure must not fail fulfilment — the tickets exist and the
  // resend flow can recover them.
  await sendTicketEmail({
    event: issued.value.event,
    tickets: issued.value.tickets,
    origin,
    idempotencyKey: `tickets:issued:${issued.value.orderId}`,
  });

  log.info("checkout.fulfil", "Paid tickets issued", {
    sessionId,
    slug: claimed.event_slug,
    count: issued.value.tickets.length,
  });

  return { outcome: "issued", tickets: issued.value.tickets };
}

export type SelfRefundResult = TicketOpResult<{
  state: "succeeded" | "pending";
  refunded: number;
  emailQueued: boolean;
}>;

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
    parent_ticket_id: string | null;
  }>(`select order_id, payment_ref, event_slug, parent_ticket_id from tickets where id = $1`, [
    input.ticketId,
  ]);

  if (!anchor) return { ok: false, status: 404, error: "Ticket not found" };
  if (input.reason === "self-serve" && anchor.parent_ticket_id) {
    return {
      ok: false,
      status: 403,
      error: "Only the purchaser ticket can refund this order",
    };
  }
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
    const event = await getEvent(anchor.event_slug);
    const delivery = event ? await sendRefundEmail({ event, tickets }) : null;
    return {
      ok: true,
      value: { state: "succeeded", refunded: 0, emailQueued: delivery?.queued ?? false },
    };
  }

  const refund = await refundPayment({
    paymentIntentId: anchor.payment_ref,
    reference: `order:${anchor.order_id}`,
  });
  if (!refund.ok) return { ok: false, status: 502, error: refund.error };

  if (refund.status === "failed" || refund.status === "canceled") {
    return { ok: false, status: 502, error: "Stripe could not process the refund" };
  }

  if (refund.status !== "succeeded") {
    const pending = await markOrderRefundPending(anchor.payment_ref, refund.refundId);
    log.info("checkout.refund", "Order refund is pending", {
      orderId: anchor.order_id,
      count: pending.length,
      reason: input.reason,
    });
    return {
      ok: true,
      value: { state: "pending", refunded: pending.length, emailQueued: false },
    };
  }

  const updated = await markOrderRefunded(anchor.payment_ref, refund.refundId);
  let emailQueued = false;
  if (updated.length > 0) {
    const event = await getEvent(anchor.event_slug);
    if (event) {
      const delivery = await sendRefundEmail({ event, tickets: updated });
      emailQueued = delivery.queued;
    }
  }
  log.info("checkout.refund", "Order refunded", {
    orderId: anchor.order_id,
    count: updated.length,
    reason: input.reason,
  });

  return {
    ok: true,
    value: { state: "succeeded", refunded: updated.length, emailQueued },
  };
}

export { ticketPath };

/**
 * What the buyer sees when Stripe sends them back.
 *
 * `pending` is a first-class answer, not an error: the tickets are issued by
 * the webhook, and a redirect can beat a webhook. Somebody standing on the
 * confirmation page needs to be told that their money arrived and their
 * tickets are seconds away, rather than being shown an empty page or a
 * "ticket not found".
 */
export type CheckoutOutcome =
  | { state: "unknown" }
  | { state: "pending" }
  | { state: "problem"; message: string }
  | {
      state: "complete";
      event: EventRecord;
      orderId: string;
      tickets: TicketRecord[];
      email: string;
      amountMinor: number;
      currency: string;
    };

/** Stripe Checkout session ids. Cheap rejection before touching the database. */
const CHECKOUT_SESSION_ID = /^cs_[A-Za-z0-9_]{10,120}$/;

export function isCheckoutSessionId(value: unknown): value is string {
  return typeof value === "string" && CHECKOUT_SESSION_ID.test(value);
}

type CheckoutOutcomeRow = {
  status: string;
  event_slug: string;
  order_id: string | null;
  email: string;
  amount_minor: number;
  currency: string;
  fulfil_ready: boolean;
};

function readCheckoutOutcomeRow(sessionId: string) {
  return queryOne<CheckoutOutcomeRow>(
    `select status, event_slug, order_id, email, amount_minor, currency,
            (updated_at < now() - interval '3 seconds') as fulfil_ready
       from checkout_sessions
      where id = $1`,
    [sessionId],
  );
}

const PROBLEM_MESSAGES: Record<string, string> = {
  expired: "This checkout expired before it was paid, so no tickets were issued.",
  refunded: "This payment was refunded, so the tickets it paid for are no longer valid.",
  refund_pending: "This payment is being refunded. The money is on its way back to you.",
  refund_failed: "A refund on this payment could not be completed. Message us and we'll sort it.",
  disputed: "This payment is disputed, so its tickets are on hold until that is resolved.",
  payment_mismatch: "Something about this payment doesn't add up. Message us before the night.",
};

/**
 * Resolve a checkout for its buyer, nudging fulfilment along if the webhook
 * has not landed.
 *
 * The nudge is the same `fulfilCheckout` the webhook calls, so it cannot
 * issue a second set of tickets and cannot issue any without asking Stripe
 * whether the session was actually paid. It exists because the alternative —
 * telling a paying customer to wait on infrastructure they cannot see — is
 * how a purchase turns into a support message. `fulfil_ready` throttles it to
 * roughly one attempt every few seconds however often the page polls.
 */
export async function resolveCheckoutOutcome(
  sessionId: string,
  origin: string,
): Promise<CheckoutOutcome> {
  if (!isCheckoutSessionId(sessionId)) return { state: "unknown" };

  let row = await readCheckoutOutcomeRow(sessionId);
  if (!row) return { state: "unknown" };

  if (row.status === "pending" && row.fulfil_ready) {
    try {
      await fulfilCheckout(sessionId, origin);
    } catch (error) {
      // A failed nudge is not the buyer's problem — the webhook still owns
      // this, and the page will keep reporting `pending`.
      log.error("checkout.outcome", "Fulfilment nudge failed", { sessionId }, error);
    }
    row = (await readCheckoutOutcomeRow(sessionId)) ?? row;
  }

  if (row.status === "fulfilled" && row.order_id) {
    const [event, tickets] = await Promise.all([
      getEvent(row.event_slug),
      listTicketsForOrder(row.order_id),
    ]);
    if (!event || tickets.length === 0) return { state: "pending" };
    return {
      state: "complete",
      event,
      orderId: row.order_id,
      tickets,
      email: row.email,
      amountMinor: row.amount_minor,
      currency: row.currency,
    };
  }

  const problem = PROBLEM_MESSAGES[row.status];
  if (problem) return { state: "problem", message: problem };

  return { state: "pending" };
}
