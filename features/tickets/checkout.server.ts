import { randomBytes, randomUUID } from "node:crypto";

import { log } from "@/lib/platform/logger.server";
import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import { recordMarketingConsent } from "@/features/communications/marketing-consent.server";
import {
  MARKETING_PRIVACY_NOTICE_VERSION,
  TICKET_MARKETING_CONSENT_VERSION,
} from "@/features/communications/marketing-consent";
import {
  createCheckoutSession,
  expireCheckoutSession,
  isPaymentsConfigured,
  listPaymentRefunds,
  refundPayment,
  retrievePaymentBalance,
  retrieveSession,
} from "@/lib/platform/stripe.server";
import { getEvent } from "@/features/events/store.server";
import { formatMoney, ticketTypeSalesState, type EventRecord } from "@/features/events/types";
import { buildEventBoughtUrl, buildEventUrl, ticketPath } from "@/features/events/routes";
import {
  listRefundedTicketsForPayment,
  listTicketsForCheckout,
  listTicketsForOrder,
  markOrderRefunded,
  markTicketStatus,
  markTicketOrderRefunded,
  markTicketOrderRefundPending,
} from "./store.server";
import { countCheckoutHolds, countExchangeHolds } from "./capacity.server";
import { hashEmail, isTicketSigningConfigured } from "./qr.server";
import { issueTickets, type TicketOpResult } from "./tickets.server";
import { sendRefundEmail, sendTicketEmail } from "./email.server";
import { getCheckoutMinimumMinor, isCheckoutTotalSupported } from "./payment-limits";
import { isValidEmail, normaliseEmail, type TicketRecord } from "./types";
import {
  cancelAwaitingOrderExchanges,
  exchangeRefundTotalForPayment,
  listOrderExchangePayments,
} from "./exchange.server";

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
  marketingOptIn: boolean;
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

  const email = normaliseEmail(input.email);
  const reference =
    input.checkoutRequestId && /^[A-Za-z0-9_-]{16,64}$/.test(input.checkoutRequestId)
      ? input.checkoutRequestId
      : randomBytes(16).toString("base64url");
  const emailHash = hashEmail(email);
  const reservation = await transaction(async (client) => {
    const eventRow = await client.query<{
      title: string;
      status: EventRecord["status"];
      starts_at: Date;
      ends_at: Date | null;
      capacity: number | null;
      terms: string | null;
      refund_policy: string | null;
      transferable: boolean;
    }>(
      `select title, status, starts_at, ends_at, capacity, terms, refund_policy, transferable
         from events where slug = $1 for update`,
      [event.slug],
    );
    const typeRow = await client.query<{
      name: string;
      price_minor: number;
      currency: string;
      quantity: number;
      per_person_limit: number;
      sales_start: Date | null;
      sales_end: Date | null;
      hidden: boolean;
    }>(
      `select name, price_minor, currency, quantity, per_person_limit,
              sales_start, sales_end, hidden from ticket_types
        where event_slug = $1 and id = $2 for update`,
      [event.slug, ticketType.id],
    );
    const storedEvent = eventRow.rows[0];
    const storedType = typeRow.rows[0];
    if (!storedEvent || !storedType) {
      return { ok: false as const, status: 404, error: "Ticket type not found" };
    }

    const existing = await client.query<{
      id: string;
      event_slug: string;
      ticket_type_id: string;
      quantity: number;
      email_hash: string;
      amount_minor: number;
      currency: string;
      status: string;
      checkout_url: string | null;
      expires_at: Date;
    }>(`select * from checkout_sessions where reference = $1 for update`, [reference]);
    const prior = existing.rows[0];
    if (
      prior &&
      (prior.event_slug !== event.slug ||
        prior.ticket_type_id !== ticketType.id ||
        prior.quantity !== quantity ||
        prior.email_hash !== emailHash)
    ) {
      return { ok: false as const, status: 409, error: "This checkout request has changed" };
    }
    if (
      prior?.status === "pending" &&
      prior.checkout_url &&
      prior.expires_at.getTime() > Date.now()
    ) {
      return {
        ok: true as const,
        existing: { id: prior.id, url: prior.checkout_url },
      };
    }
    if (prior && prior.status !== "creating") {
      return {
        ok: false as const,
        status: 409,
        error: "This checkout is no longer active. Start again.",
      };
    }

    if (storedType.hidden) {
      return { ok: false as const, status: 404, error: "Ticket type not found" };
    }
    if (storedType.price_minor <= 0) {
      return { ok: false as const, status: 400, error: "This ticket is free — no payment needed" };
    }
    const sales = ticketTypeSalesState(
      {
        status: storedEvent.status,
        startsAt: storedEvent.starts_at.toISOString(),
        endsAt: storedEvent.ends_at?.toISOString(),
      },
      {
        id: ticketType.id,
        name: storedType.name,
        priceMinor: storedType.price_minor,
        currency: storedType.currency,
        quantity: storedType.quantity,
        perPersonLimit: storedType.per_person_limit,
        salesStart: storedType.sales_start?.toISOString(),
        salesEnd: storedType.sales_end?.toISOString(),
        hidden: storedType.hidden,
      },
      0,
    );
    if (sales.state !== "on-sale") {
      return { ok: false as const, status: 409, error: "These tickets aren't on sale right now" };
    }
    if (quantity > storedType.per_person_limit) {
      return {
        ok: false as const,
        status: 409,
        error: `Limit of ${storedType.per_person_limit} per person for ${storedType.name}`,
      };
    }
    const amountMinor = storedType.price_minor * quantity;
    if (
      prior &&
      (prior.amount_minor !== amountMinor ||
        prior.currency.toLowerCase() !== storedType.currency.toLowerCase())
    ) {
      return { ok: false as const, status: 409, error: "This checkout request has changed" };
    }
    if (!isCheckoutTotalSupported(storedType.price_minor, quantity, storedType.currency)) {
      const minimum = getCheckoutMinimumMinor(storedType.currency);
      return {
        ok: false as const,
        status: 409,
        error: minimum
          ? `Online payments must total at least ${formatMoney(minimum, storedType.currency)}`
          : "That payment total is too low",
      };
    }

    const heldResult = await client.query<{ held: string }>(
      `select count(*)::text as held from tickets
        where event_slug = $1 and ticket_type_id = $2
          and email_hash = $3 and status = 'valid'`,
      [event.slug, ticketType.id, emailHash],
    );
    const soldResult = await client.query<{ sold: string }>(
      `select count(*)::text as sold from tickets
        where event_slug = $1 and ticket_type_id = $2 and status = 'valid'`,
      [event.slug, ticketType.id],
    );
    const eventSoldResult = await client.query<{ sold: string }>(
      `select count(*)::text as sold from tickets
        where event_slug = $1 and status = 'valid'`,
      [event.slug],
    );
    const checkoutTypeHeld = await countCheckoutHolds(client, {
      eventSlug: event.slug,
      ticketTypeId: ticketType.id,
      excludeReference: reference,
    });
    const checkoutEventHeld = await countCheckoutHolds(client, {
      eventSlug: event.slug,
      excludeReference: reference,
    });
    const checkoutPersonHeld = await countCheckoutHolds(client, {
      eventSlug: event.slug,
      ticketTypeId: ticketType.id,
      emailHash,
      excludeReference: reference,
    });
    const exchangeTypeHeld = await countExchangeHolds(client, {
      eventSlug: event.slug,
      ticketTypeId: ticketType.id,
    });
    const exchangePersonHeld = await countExchangeHolds(client, {
      eventSlug: event.slug,
      ticketTypeId: ticketType.id,
      emailHash,
    });
    const held = Number(heldResult.rows[0]?.held ?? 0);
    if (held + checkoutPersonHeld + exchangePersonHeld + quantity > storedType.per_person_limit) {
      return {
        ok: false as const,
        status: 409,
        error: `Limit of ${storedType.per_person_limit} per person for ${ticketType.name}`,
      };
    }
    const sold = Number(soldResult.rows[0]?.sold ?? 0);
    const eventSold = Number(eventSoldResult.rows[0]?.sold ?? 0);
    const typeRemaining = Math.max(
      0,
      storedType.quantity - sold - checkoutTypeHeld - exchangeTypeHeld,
    );
    const eventRemaining =
      storedEvent.capacity === null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, storedEvent.capacity - eventSold - checkoutEventHeld);
    const available = Math.min(typeRemaining, eventRemaining);
    if (quantity > available) {
      return {
        ok: false as const,
        status: 409,
        error: available === 0 ? "Sold out" : `Only ${available} left`,
      };
    }

    if (!prior) {
      await client.query(
        `insert into checkout_sessions (
           id, event_slug, ticket_type_id, quantity, holder_name, email, email_hash,
           amount_minor, currency, reference, status, terms_accepted_at, terms_snapshot,
           marketing_opted_in, marketing_opted_in_at, expires_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'creating',now(),$11::jsonb,$12,
                   case when $12 then now() else null end, now() + interval '2 minutes')`,
        [
          `reservation_${reference}`,
          event.slug,
          ticketType.id,
          quantity,
          holderName,
          email,
          emailHash,
          amountMinor,
          storedType.currency,
          reference,
          JSON.stringify({
            eventTerms: storedEvent.terms,
            refundPolicy: storedEvent.refund_policy,
            transferable: storedEvent.transferable,
          }),
          input.marketingOptIn === true,
        ],
      );
    } else {
      await client.query(
        `update checkout_sessions
            set status = 'creating', expires_at = now() + interval '2 minutes', updated_at = now()
          where reference = $1`,
        [reference],
      );
    }
    return {
      ok: true as const,
      existing: null,
      checkout: {
        eventTitle: storedEvent.title,
        ticketTypeName: storedType.name,
        priceMinor: storedType.price_minor,
        currency: storedType.currency,
      },
    };
  });
  if (!reservation.ok) return reservation;
  if (reservation.existing) {
    return {
      ok: true,
      value: { url: reservation.existing.url, sessionId: reservation.existing.id },
    };
  }
  const checkout = reservation.checkout;

  let session: { id: string; url: string; expiresAt: string };
  try {
    session = await createCheckoutSession({
      eventTitle: checkout.eventTitle,
      ticketTypeName: checkout.ticketTypeName,
      priceMinor: checkout.priceMinor,
      currency: checkout.currency,
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
    await query(
      `update checkout_sessions set status = 'failed', updated_at = now()
        where reference = $1 and status = 'creating'`,
      [reference],
    );
    return { ok: false, status: 502, error: "Could not start checkout. Try again." };
  }

  try {
    const persisted = await query<{ id: string }>(
      `update checkout_sessions
          set id = $2, checkout_url = $3, expires_at = $4, status = 'pending', updated_at = now()
        where reference = $1 and status = 'creating'
        returning id`,
      [reference, session.id, session.url, session.expiresAt],
    );
    if (persisted.length === 0) {
      const current = await queryOne<{ id: string; status: string; checkout_url: string | null }>(
        `select id, status, checkout_url from checkout_sessions where reference = $1`,
        [reference],
      );
      if (
        current?.id !== session.id ||
        current.status !== "pending" ||
        current.checkout_url !== session.url
      ) {
        throw new Error("Checkout reservation was not persisted");
      }
    }
  } catch (error) {
    await expireCheckoutSession(session.id);
    await query(
      `update checkout_sessions set status = 'failed', updated_at = now()
        where reference = $1 and status = 'creating'`,
      [reference],
    ).catch(() => undefined);
    log.error("checkout.create", "Checkout ledger finalization failed", { reference }, error);
    return { ok: false, status: 502, error: "Could not start checkout. Try again." };
  }

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
  marketing_opted_in: boolean;
  marketing_opted_in_at: Date | null;
};

async function recordPaidMarketingConsent(input: {
  enabled: boolean;
  email: string;
  displayName: string;
  sourceRef: string;
  occurredAt: Date | null;
  eventSlug: string;
}): Promise<void> {
  if (!input.enabled) return;
  try {
    await recordMarketingConsent({
      email: input.email,
      displayName: input.displayName,
      source: "ticket_purchase",
      sourceRef: input.sourceRef,
      consentVersion: TICKET_MARKETING_CONSENT_VERSION,
      privacyVersion: MARKETING_PRIVACY_NOTICE_VERSION,
      occurredAt: input.occurredAt ?? new Date(),
    });
  } catch (error) {
    // Payment and ticket fulfilment must remain recoverable if the optional
    // marketing contact write is temporarily unavailable. A later webhook
    // retry can fill the same idempotent consent record.
    log.error(
      "marketing.consent",
      "Paid ticket consent could not be saved",
      { eventSlug: input.eventSlug },
      error,
    );
  }
}

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
      where id = $1 and status in ('pending', 'payment_pending')`,
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

  // A cheaper ticket exchange is a partial refund without cancelling the QR.
  // Remove those exchange refunds before applying the remainder to admission.
  const exchangeRefundedMinor = await exchangeRefundTotalForPayment(paymentIntentId);
  const cancellationRefundedMinor = Math.max(0, amountRefundedMinor - exchangeRefundedMinor);
  if (cancellationRefundedMinor === 0) return { amountRefundedMinor, tickets: [] };

  const refundRef = succeeded.at(-1)?.id ?? paymentIntentId;
  const tickets = await markOrderRefunded(paymentIntentId, refundRef, cancellationRefundedMinor);
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
            status in ('pending', 'payment_pending')
            or (status = 'fulfilling' and processing_started_at < now() - interval '2 minutes')
          )
        returning id, event_slug, ticket_type_id, quantity, holder_name, email,
                  amount_minor, currency, reference, marketing_opted_in,
                  marketing_opted_in_at`,
      [sessionId],
    );
    return rows[0] ?? null;
  });

  if (!claimed) {
    const existing = await queryOne<{
      status: string;
      marketing_opted_in: boolean;
      marketing_opted_in_at: Date | null;
      holder_name: string;
      email: string;
    }>(
      `select status, marketing_opted_in, marketing_opted_in_at, holder_name, email
         from checkout_sessions where id = $1`,
      [sessionId],
    );
    if (!existing) return { outcome: "unknown-session" };
    if (existing.status === "fulfilled") {
      const tickets = await listTicketsForCheckout(sessionId);
      if (tickets.length > 0) {
        await recordPaidMarketingConsent({
          enabled: existing.marketing_opted_in,
          email: existing.email,
          displayName: existing.holder_name,
          sourceRef: tickets[0].orderId,
          occurredAt: existing.marketing_opted_in_at,
          eventSlug: tickets[0].eventSlug,
        });
        const event = await getEvent(tickets[0].eventSlug);
        if (event)
          await sendTicketEmail({
            event,
            tickets,
            origin,
            idempotencyKey: `tickets:issued:${tickets[0].orderId}`,
            kind: "ticket-issued",
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
    const waitingStatus = session?.status === "complete" ? "payment_pending" : "pending";
    await query(
      `update checkout_sessions
          set status = $2, processing_started_at = null, updated_at = now()
        where id = $1`,
      [sessionId, waitingStatus],
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
          set status = 'payment_pending', processing_started_at = null, updated_at = now()
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
            set status = 'payment_pending', processing_started_at = null, updated_at = now()
          where id = $1`,
        [sessionId],
      );
      return { outcome: "failed", error: refund.error };
    }
    if (refund && (refund.status === "failed" || refund.status === "canceled")) {
      await query(
        `update checkout_sessions
            set status = 'payment_pending', processing_started_at = null, updated_at = now()
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
    await recordPaidMarketingConsent({
      enabled: claimed.marketing_opted_in,
      email: claimed.email,
      displayName: claimed.holder_name,
      sourceRef: orderId,
      occurredAt: claimed.marketing_opted_in_at,
      eventSlug: claimed.event_slug,
    });
    const event = await getEvent(claimed.event_slug);
    if (event)
      await sendTicketEmail({
        event,
        tickets: recoveredTickets,
        origin,
        idempotencyKey: `tickets:issued:${orderId}`,
        kind: "ticket-issued",
      });
    log.info("checkout.fulfil", "Recovered tickets after interrupted fulfilment", {
      sessionId,
      count: recoveredTickets.length,
    });
    return { outcome: "already-issued" };
  }

  let issued;
  try {
    const allocationBase = Math.floor(claimed.amount_minor / Math.max(1, claimed.quantity));
    const allocationRemainder = claimed.amount_minor - allocationBase * claimed.quantity;
    issued = await issueTickets({
      eventSlug: claimed.event_slug,
      ticketTypeId: claimed.ticket_type_id,
      holderName: claimed.holder_name,
      email: claimed.email,
      quantity: claimed.quantity,
      kind: "paid",
      paymentRef: session.paymentIntentId ?? undefined,
      checkoutRef: sessionId,
      capacityHoldReference: claimed.reference ?? undefined,
      // The reservation was accepted while sales were open. Closing sales
      // while the buyer is at Stripe must not invalidate a paid order.
      bypassSalesWindow: true,
      // Preserve the exact paid total even when it does not divide evenly.
      // The first few tickets receive one extra minor unit deterministically.
      amountAllocationsMinor: Array.from(
        { length: claimed.quantity },
        (_, index) => allocationBase + (index < allocationRemainder ? 1 : 0),
      ),
      currency: claimed.currency,
    });
  } catch (error) {
    // An unexpected throw (not a refusal) must release the claim, or the row
    // is stuck in `fulfilling` and Stripe's retry would read "already-issued"
    // — money kept, no tickets, forever.
    await query(
      `update checkout_sessions
          set status = 'payment_pending', processing_started_at = null, updated_at = now()
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
            set status = 'payment_pending', processing_started_at = null, updated_at = now()
          where id = $1`,
        [sessionId],
      );
      return { outcome: "failed", error: refund.error };
    }
    if (refund.status === "failed" || refund.status === "canceled") {
      await query(
        `update checkout_sessions
            set status = 'payment_pending', processing_started_at = null, updated_at = now()
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
  await recordPaidMarketingConsent({
    enabled: claimed.marketing_opted_in,
    email: claimed.email,
    displayName: claimed.holder_name,
    sourceRef: issued.value.orderId,
    occurredAt: claimed.marketing_opted_in_at,
    eventSlug: claimed.event_slug,
  });

  // Delivery failure must not fail fulfilment — the tickets exist and the
  // resend flow can recover them.
  await sendTicketEmail({
    event: issued.value.event,
    tickets: issued.value.tickets,
    origin,
    idempotencyKey: `tickets:issued:${issued.value.orderId}`,
    kind: "ticket-issued",
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
 * Refund exactly one child ticket. The ticket is made unusable in the same
 * transaction that reserves its refund allocation, closing the check-in race.
 * A failed provider call restores it; a pending provider response remains
 * visibly void until the refund webhook settles it.
 */
export async function refundTicket(input: {
  ticketId: string;
  reason: "self-serve" | "admin";
  actorId?: string;
  returnRequestId?: string;
}): Promise<SelfRefundResult> {
  const prepared = await transaction(async (client) => {
    const selected = await client.query<{
      id: string;
      event_slug: string;
      order_id: string;
      payment_ref: string | null;
      amount_paid_minor: number | null;
      currency: string | null;
      status: string;
      redeemed_at: Date | null;
    }>(
      `select id,event_slug,order_id,payment_ref,amount_paid_minor,currency,status,redeemed_at
          from tickets where id = $1 for update`,
      [input.ticketId],
    );
    const ticket = selected.rows[0];
    if (!ticket) return { ok: false as const, status: 404, error: "Ticket not found" };
    if (ticket.status === "refunded")
      return { ok: true as const, alreadyRefunded: true as const, ticket };
    if (ticket.status !== "valid")
      return { ok: false as const, status: 409, error: "This ticket is not refundable" };
    if (ticket.redeemed_at)
      return { ok: false as const, status: 409, error: "This ticket has already checked in" };
    if (!ticket.payment_ref || !ticket.amount_paid_minor || !ticket.currency)
      return { ok: false as const, status: 400, error: "This ticket has no refundable payment" };
    const exchange = await client.query(
      `select 1 from ticket_exchanges where ticket_id = $1
        and status in ('processing','awaiting_payment','refund_pending') limit 1`,
      [ticket.id],
    );
    if (exchange.rowCount)
      return { ok: false as const, status: 409, error: "Finish or cancel the ticket change first" };
    const acceptedTransfer = await client.query(
      `select 1 from ticket_transfers where ticket_id = $1 and status = 'accepted' limit 1`,
      [ticket.id],
    );
    if (acceptedTransfer.rowCount) {
      if (!input.returnRequestId)
        return {
          ok: false as const,
          status: 409,
          error: "A transferred ticket needs the current holder's consent before refund",
        };
      const consent = await client.query<{ id: string }>(
        `select request.id
           from ticket_return_requests request
           join event_participants participant on participant.ticket_id = request.ticket_id
          where request.id = $1 and request.ticket_id = $2 and request.status = 'confirmed'
            and participant.person_id = request.holder_person_id
          for update of request`,
        [input.returnRequestId, ticket.id],
      );
      if (!consent.rows[0])
        return {
          ok: false as const,
          status: 409,
          error: "Current-holder consent is missing or no longer matches this ticket",
        };
    }
    const pendingTransfers = await client.query<{ action_link_id: string | null }>(
      `update ticket_transfers
          set status = 'invalidated',invalidated_at = now(),
              invalidation_reason = 'refund-started',updated_at = now()
        where ticket_id = $1 and status = 'pending' returning action_link_id`,
      [ticket.id],
    );
    for (const transfer of pendingTransfers.rows) {
      if (transfer.action_link_id) {
        await client.query(
          `update attendee_action_links
              set revoked_at = now(),revoke_reason = 'refund-started'
            where id = $1 and consumed_at is null`,
          [transfer.action_link_id],
        );
      }
    }
    const allocationId = `refund_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
    if (input.returnRequestId) {
      await client.query(
        `update ticket_return_requests
            set status = 'refund-pending',updated_at = now()
          where id = $1 and status = 'confirmed'`,
        [input.returnRequestId],
      );
    }
    await client.query(
      `insert into ticket_refund_allocations
         (id,ticket_id,event_slug,payment_ref,amount_minor,currency,initiated_by_type,initiated_by_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        allocationId,
        ticket.id,
        ticket.event_slug,
        ticket.payment_ref,
        ticket.amount_paid_minor,
        ticket.currency,
        input.reason === "admin" ? "admin" : "attendee",
        input.actorId ?? null,
      ],
    );
    await client.query(`update tickets set status = 'void' where id = $1`, [ticket.id]);
    await client.query(
      `update event_participants set status = 'void',updated_at = now() where ticket_id = $1`,
      [ticket.id],
    );
    await client.query(
      `insert into attendee_operations_audit_events
         (action,actor_type,actor_id,event_slug,entity_type,entity_id,
          before_state,after_state,reason,affected_count,correlation_id)
       values ('ticket.refund.started',$1,$2,$3,'ticket',$4,
               '{"status":"valid"}'::jsonb,'{"status":"void","refund":"processing"}'::jsonb,
               $5,1,$6)`,
      [
        input.reason === "admin" ? "root-owner" : "attendee",
        input.actorId ?? null,
        ticket.event_slug,
        ticket.id,
        input.reason,
        allocationId,
      ],
    );
    return {
      ok: true as const,
      alreadyRefunded: false as const,
      ticket,
      allocationId,
      returnRequestId: input.returnRequestId,
    };
  });
  if (!prepared.ok) return prepared;
  if (prepared.alreadyRefunded)
    return { ok: true, value: { state: "succeeded", refunded: 0, emailQueued: false } };

  const refund = await refundPayment({
    paymentIntentId: prepared.ticket.payment_ref!,
    amountMinor: prepared.ticket.amount_paid_minor!,
    reference: `ticket:${prepared.ticket.id}:${prepared.allocationId}`,
    metadata: {
      ticketId: prepared.ticket.id,
      allocationId: prepared.allocationId,
      orderId: prepared.ticket.order_id,
      refundPurpose: "ticket_refund",
    },
  });
  if (!refund.ok || refund.status === "failed" || refund.status === "canceled") {
    await transaction(async (client) => {
      await client.query(
        `update ticket_refund_allocations
            set state = 'failed',failure_reason = $2,updated_at = now(),completed_at = now()
          where id = $1`,
        [prepared.allocationId, refund.ok ? "Provider rejected the refund" : refund.error],
      );
      await client.query(`update tickets set status = 'valid' where id = $1 and status = 'void'`, [
        prepared.ticket.id,
      ]);
      await client.query(
        `update event_participants set status = 'active',updated_at = now()
          where ticket_id = $1 and status = 'void'`,
        [prepared.ticket.id],
      );
      if (prepared.returnRequestId) {
        await client.query(
          `update ticket_return_requests
              set status = 'failed',resolved_at = now(),resolution_reason = $2,updated_at = now()
            where id = $1`,
          [prepared.returnRequestId, refund.ok ? "Provider rejected the refund" : refund.error],
        );
      }
    });
    const { emitDomainEvent } = await import("@/features/attendee-operations/notifications.server");
    await emitDomainEvent({
      kind: "refund.failed",
      deduplicationKey: `refund-allocation:${prepared.allocationId}:failed`,
      actorType: input.reason === "admin" ? "admin" : "attendee",
      actorId: input.actorId,
      eventSlug: prepared.ticket.event_slug,
      entityRefs: { ticketId: prepared.ticket.id, allocationId: prepared.allocationId },
      severity: "critical",
      admin: {
        title: "Ticket refund failed",
        body: "The provider rejected a per-ticket refund. The ticket was restored and needs review.",
        deepLink: `/admin?view=operations&ticket=${encodeURIComponent(prepared.ticket.id)}`,
        category: "refund-failed",
        createCase: true,
      },
    });
    return {
      ok: false,
      status: 502,
      error: refund.ok ? "Stripe could not process the refund" : refund.error,
    };
  }

  const state = refund.status === "succeeded" ? "succeeded" : "pending";
  await query(
    `update ticket_refund_allocations
        set state = $2,refund_ref = $3,updated_at = now(),
            completed_at = case when $2 = 'succeeded' then now() else null end
      where id = $1`,
    [prepared.allocationId, state, refund.refundId],
  );
  if (state === "pending") {
    const { emitDomainEvent } = await import("@/features/attendee-operations/notifications.server");
    await emitDomainEvent({
      kind: "refund.pending",
      deduplicationKey: `refund-allocation:${prepared.allocationId}:pending`,
      actorType: input.reason === "admin" ? "root-owner" : "attendee",
      actorId: input.actorId,
      eventSlug: prepared.ticket.event_slug,
      entityRefs: { ticketId: prepared.ticket.id, allocationId: prepared.allocationId },
    });
    return { ok: true, value: { state: "pending", refunded: 1, emailQueued: false } };
  }
  const updated = await markTicketStatus(prepared.ticket.id, "refunded", refund.refundId);
  if (prepared.returnRequestId) {
    await query(
      `update ticket_return_requests
          set status = 'refunded',resolved_at = now(),resolution_reason = 'refund-succeeded',updated_at = now()
        where id = $1`,
      [prepared.returnRequestId],
    );
  }
  const event = await getEvent(prepared.ticket.event_slug);
  const delivery =
    updated && event
      ? await sendRefundEmail({
          event,
          tickets: [updated],
          source: input.reason === "admin" ? "admin" : "self-service",
        })
      : null;
  const { emitDomainEvent } = await import("@/features/attendee-operations/notifications.server");
  await emitDomainEvent({
    kind: "refund.completed",
    deduplicationKey: `refund-allocation:${prepared.allocationId}:completed`,
    actorType: input.reason === "admin" ? "root-owner" : "attendee",
    actorId: input.actorId,
    eventSlug: prepared.ticket.event_slug,
    entityRefs: { ticketId: prepared.ticket.id, allocationId: prepared.allocationId },
  });
  return {
    ok: true,
    value: {
      state: "succeeded",
      refunded: updated ? 1 : 0,
      emailQueued: delivery?.queued ?? false,
    },
  };
}

export async function updateAllocatedTicketRefund(
  refundId: string,
  status: string | null,
): Promise<boolean> {
  if (status !== "succeeded" && status !== "failed" && status !== "canceled") return false;
  const existing = await queryOne<{ state: string }>(
    `select state from ticket_refund_allocations where refund_ref = $1`,
    [refundId],
  );
  if (!existing) return false;
  if (existing.state === "succeeded" || existing.state === "failed") return true;
  const rows = await query<{ ticket_id: string; event_slug: string }>(
    `update ticket_refund_allocations
        set state = $2,updated_at = now(),completed_at = now(),
            failure_reason = case when $2 = 'failed' then 'Provider reported refund failure' else null end
      where refund_ref = $1 and state in ('processing','pending')
      returning ticket_id,event_slug`,
    [refundId, status === "succeeded" ? "succeeded" : "failed"],
  );
  const allocation = rows[0];
  if (!allocation) return false;
  if (status === "succeeded") {
    await query(
      `update ticket_return_requests
          set status = 'refunded',resolved_at = now(),resolution_reason = 'refund-succeeded',updated_at = now()
        where ticket_id = $1 and status = 'refund-pending'`,
      [allocation.ticket_id],
    );
    const ticket = await markTicketStatus(allocation.ticket_id, "refunded", refundId);
    const event = await getEvent(allocation.event_slug);
    if (ticket && event) {
      await sendRefundEmail({
        event,
        tickets: [ticket],
        source: "system",
        idempotencyKey: `tickets:refund:${ticket.id}:${refundId}`,
      });
    }
    const { emitDomainEvent } = await import("@/features/attendee-operations/notifications.server");
    await emitDomainEvent({
      kind: "refund.completed",
      deduplicationKey: `refund:${refundId}:completed`,
      actorType: "system",
      eventSlug: allocation.event_slug,
      entityRefs: { ticketId: allocation.ticket_id, refundId },
    });
  } else {
    await query(
      `update ticket_return_requests
          set status = 'failed',resolved_at = now(),
              resolution_reason = 'provider-reported-refund-failure',updated_at = now()
        where ticket_id = $1 and status = 'refund-pending'`,
      [allocation.ticket_id],
    );
    await query(`update tickets set status = 'valid' where id = $1 and status = 'void'`, [
      allocation.ticket_id,
    ]);
    await query(
      `update event_participants set status = 'active',updated_at = now()
        where ticket_id = $1 and status = 'void'`,
      [allocation.ticket_id],
    );
    const { emitDomainEvent } = await import("@/features/attendee-operations/notifications.server");
    await emitDomainEvent({
      kind: "refund.failed",
      deduplicationKey: `refund:${refundId}:failed`,
      actorType: "system",
      eventSlug: allocation.event_slug,
      entityRefs: { ticketId: allocation.ticket_id, refundId },
      severity: "critical",
      admin: {
        title: "Ticket refund failed",
        body: "A pending per-ticket refund failed at the payment provider. The ticket was restored.",
        deepLink: `/admin?view=operations&ticket=${encodeURIComponent(allocation.ticket_id)}`,
        category: "refund-failed",
        createCase: true,
      },
    });
  }
  return true;
}

/**
 * Bulk-refund an order for event-cancellation operations.
 *
 * Normal attendee and admin controls use `refundTicket`; this remains a
 * deliberate bulk workflow for cancelling every ticket in an order.
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
    const delivery = event
      ? await sendRefundEmail({
          event,
          tickets,
          source: input.reason === "admin" ? "admin" : "self-service",
        })
      : null;
    return {
      ok: true,
      value: { state: "succeeded", refunded: 0, emailQueued: delivery?.queued ?? false },
    };
  }

  const cancelledExchanges = await cancelAwaitingOrderExchanges(anchor.order_id);
  if (!cancelledExchanges.ok) return cancelledExchanges;

  const exchangePayments = await listOrderExchangePayments(anchor.order_id);
  const payments = [
    ...exchangePayments,
    { exchangeId: "purchase", paymentIntentId: anchor.payment_ref },
  ];
  const refunds = [];
  for (const payment of payments) {
    const balance = await retrievePaymentBalance(payment.paymentIntentId);
    if (!balance) {
      return { ok: false, status: 502, error: "Could not verify the refundable balance" };
    }
    if (balance.remainingMinor === 0) continue;
    const refund = await refundPayment({
      paymentIntentId: payment.paymentIntentId,
      amountMinor: balance.remainingMinor,
      reference: `order:${anchor.order_id}:${payment.exchangeId}`,
      metadata: { orderId: anchor.order_id, refundPurpose: "order_refund" },
    });
    if (!refund.ok) return { ok: false, status: 502, error: refund.error };
    if (refund.status === "failed" || refund.status === "canceled") {
      return { ok: false, status: 502, error: "Stripe could not process the refund" };
    }
    refunds.push(refund);
  }

  const refundReference =
    refunds.map((refund) => refund.refundId).join(":") || `already-refunded:${anchor.order_id}`;
  if (refunds.some((refund) => refund.status !== "succeeded")) {
    const pending = await markTicketOrderRefundPending(anchor.order_id, refundReference);
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

  const updated = await markTicketOrderRefunded(anchor.order_id, refundReference);
  let emailQueued = false;
  if (updated.length > 0) {
    const event = await getEvent(anchor.event_slug);
    if (event) {
      const delivery = await sendRefundEmail({
        event,
        tickets: updated,
        source: input.reason === "admin" ? "admin" : "self-service",
      });
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

  if ((row.status === "pending" || row.status === "payment_pending") && row.fulfil_ready) {
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
