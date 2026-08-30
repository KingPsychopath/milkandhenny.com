import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";

import { getEvent } from "@/features/events/store.server";
import { formatMoney, ticketTypeSalesState, type TicketType } from "@/features/events/types";
import { buildTicketUrl } from "@/features/events/routes";
import { log } from "@/lib/platform/logger.server";
import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import {
  createCheckoutSession,
  expireCheckoutSession,
  isPaymentsConfigured,
  refundPayment,
  retrievePaymentBalance,
  retrieveSession,
} from "@/lib/platform/stripe.server";
import { sendTicketExchangeEmail, sendTicketExchangePaymentEmail } from "./email.server";
import type {
  ManagedExchangeTicket,
  TicketExchangeManagement,
  TicketExchangeStatus,
} from "./exchange-types";
import { getCheckoutMinimumMinor, isCheckoutTotalSupported } from "./payment-limits";
import {
  countCheckoutHolds,
  countExchangeHolds,
  getTicketCapacitySnapshot,
} from "./capacity.server";
import { listTicketsForOrder } from "./store.server";
import type { TicketOpResult } from "./tickets.server";
import { isValidTicketId } from "./types";

type ExchangeRow = {
  id: string;
  event_slug: string;
  order_id: string;
  ticket_id: string;
  from_ticket_type_id: string;
  to_ticket_type_id: string;
  actor_type: "purchaser" | "admin";
  status: TicketExchangeStatus;
  amount_delta_minor: number;
  currency: string;
  checkout_ref: string | null;
  payment_ref: string | null;
  dispute_ref: string | null;
  error_message: string | null;
  created_at: Date;
  completed_at: Date | null;
};

type LockedTicket = {
  id: string;
  event_slug: string;
  order_id: string;
  ticket_type_id: string;
  holder_name: string;
  email: string | null;
  email_hash: string | null;
  parent_ticket_id: string | null;
  payment_ref: string | null;
  amount_paid_minor: number | null;
  currency: string | null;
  status: string;
  redeemed_at: Date | null;
};

export type BeginTicketExchangeResult = TicketOpResult<
  | { state: "completed"; exchangeId: string; emailQueued: boolean; message: string }
  | { state: "refund_pending"; exchangeId: string; message: string }
  | { state: "checkout"; exchangeId: string; url: string }
>;

export type ExchangeOutcome =
  | { state: "unknown" }
  | { state: "pending"; message: string }
  | { state: "failed"; message: string }
  | { state: "complete"; message: string; ticketId: string };

type RefundAllocation = { paymentIntentId: string; amountMinor: number };

function exchangeId(): string {
  return `tex_${randomBytes(18).toString("base64url")}`;
}

function exchangeCloseAt(event: { doorsAt?: string; startsAt: string }): string {
  return event.doorsAt ?? event.startsAt;
}

function activeStatus(status: string): boolean {
  return ["processing", "awaiting_payment", "refund_pending"].includes(status);
}

async function verifyManager(managerTicketId: string, ticketId: string) {
  if (!isValidTicketId(managerTicketId) || !isValidTicketId(ticketId)) return null;
  return queryOne<LockedTicket>(
    `select target.id, target.event_slug, target.order_id, target.ticket_type_id,
            target.holder_name, target.email, target.parent_ticket_id, target.payment_ref,
            target.email_hash,
            target.amount_paid_minor, target.currency, target.status, target.redeemed_at
       from tickets manager
       join tickets target on target.order_id = manager.order_id
      where (manager.access_reference = $1
             or (manager.access_reference is null and manager.id = $1))
        and manager.parent_ticket_id is null
        and (target.id = $2 or target.access_reference = $2)`,
    [managerTicketId, ticketId],
  );
}

function selfServiceTypes(types: TicketType[]): TicketType[] {
  return types.filter((type) => !type.hidden);
}

export async function getTicketExchangeManagement(input: {
  managerTicketId: string;
}): Promise<TicketOpResult<TicketExchangeManagement>> {
  if (!isValidTicketId(input.managerTicketId)) {
    return { ok: false, status: 400, error: "That ticket reference doesn't look right" };
  }
  const manager = await verifyManager(input.managerTicketId, input.managerTicketId);
  if (!manager) return { ok: false, status: 403, error: "This link cannot manage that order" };

  const [event, tickets, capacity, exchanges] = await Promise.all([
    getEvent(manager.event_slug),
    listTicketsForOrder(manager.order_id),
    getTicketCapacitySnapshot(manager.event_slug),
    query<ExchangeRow>(
      `select * from ticket_exchanges
        where order_id = $1 and status in ('processing', 'awaiting_payment', 'refund_pending')
        order by created_at desc`,
      [manager.order_id],
    ),
  ]);
  if (!event) return { ok: false, status: 404, error: "Event not found" };

  const types = new Map(event.ticketTypes.map((type) => [type.id, type]));
  const active = new Map(exchanges.map((exchange) => [exchange.ticket_id, exchange]));
  const orderTickets: ManagedExchangeTicket[] = tickets.map((ticket) => {
    const type = types.get(ticket.ticketTypeId);
    const exchange = active.get(ticket.id);
    const target = exchange ? types.get(exchange.to_ticket_type_id) : undefined;
    return {
      id: ticket.id,
      holderName: ticket.holderName,
      ticketTypeId: ticket.ticketTypeId,
      ticketTypeName: type?.name ?? "Ticket",
      amountPaidMinor: ticket.amountPaidMinor ?? type?.priceMinor ?? 0,
      currency: ticket.currency ?? type?.currency ?? "GBP",
      status: ticket.status,
      redeemed: Boolean(ticket.redeemedAt),
      activeExchange: exchange
        ? {
            id: exchange.id,
            status: exchange.status,
            toTicketTypeName: target?.name ?? "Ticket",
            amountDeltaMinor: exchange.amount_delta_minor,
            errorMessage: exchange.error_message ?? undefined,
          }
        : undefined,
    };
  });
  const exchangeSalesEvent =
    event.status === "sold-out" ? { ...event, status: "published" as const } : event;
  const options = selfServiceTypes(event.ticketTypes).map((type) => {
    const occupied =
      (capacity.sold[type.id] ?? 0) +
      (capacity.checkoutReserved[type.id] ?? 0) +
      (capacity.exchangeReserved[type.id] ?? 0);
    const sales = ticketTypeSalesState(exchangeSalesEvent, type, occupied);
    const available = sales.state === "on-sale" && occupied < type.quantity;
    return {
      id: type.id,
      name: type.name,
      priceMinor: type.priceMinor,
      currency: type.currency,
      available,
      ...(!available
        ? {
            unavailableReason:
              sales.state === "sold-out" || occupied >= type.quantity
                ? ("sold-out" as const)
                : ("not-on-sale" as const),
          }
        : {}),
    };
  });

  return {
    ok: true,
    value: {
      orderId: manager.order_id,
      tickets: orderTickets,
      options,
      exchangesCloseAt: exchangeCloseAt(event),
    },
  };
}

async function reserveExchange(input: {
  managerTicketId?: string;
  ticketId: string;
  targetTicketTypeId: string;
  actorType: "purchaser" | "admin";
}): Promise<TicketOpResult<{ exchange: ExchangeRow; ticket: LockedTicket; target: TicketType }>> {
  const event = await transaction(async (client) => {
    const ticketResult = await client.query<LockedTicket>(
      input.actorType === "purchaser"
        ? `select target.id, target.event_slug, target.order_id, target.ticket_type_id,
                  target.holder_name, target.email, target.parent_ticket_id, target.payment_ref,
                  target.email_hash,
                  target.amount_paid_minor, target.currency, target.status, target.redeemed_at
             from tickets manager
             join tickets target on target.order_id = manager.order_id
            where (manager.access_reference = $1
                   or (manager.access_reference is null and manager.id = $1))
              and manager.parent_ticket_id is null
              and (target.id = $2 or target.access_reference = $2)
            for update of target`
        : `select id, event_slug, order_id, ticket_type_id, holder_name, email, email_hash,
                  parent_ticket_id, payment_ref, amount_paid_minor, currency, status, redeemed_at
             from tickets where id = $2 for update`,
      [input.managerTicketId ?? input.ticketId, input.ticketId],
    );
    const ticket = ticketResult.rows[0];
    if (!ticket) return { error: "This link cannot manage that ticket", status: 403 } as const;
    if (ticket.status !== "valid") {
      return { error: "Only a valid ticket can be changed", status: 409 } as const;
    }
    if (ticket.redeemed_at) {
      return { error: "This ticket has already been checked in", status: 409 } as const;
    }
    if (ticket.ticket_type_id === input.targetTicketTypeId) {
      return { error: "That ticket already has this type", status: 409 } as const;
    }

    const eventResult = await client.query<{
      doors_at: Date | null;
      starts_at: Date;
      status: string;
    }>(`select doors_at, starts_at, status from events where slug = $1 for update`, [
      ticket.event_slug,
    ]);
    const eventRow = eventResult.rows[0];
    if (!eventRow) return { error: "Event not found", status: 404 } as const;
    if (Date.now() >= (eventRow.doors_at ?? eventRow.starts_at).getTime()) {
      return { error: "Ticket changes close when doors open", status: 409 } as const;
    }
    if (input.actorType === "purchaser" && eventRow.status === "cancelled") {
      return { error: "Tickets for a cancelled event cannot be changed", status: 409 } as const;
    }

    const typeResult = await client.query<{
      id: string;
      name: string;
      description: string | null;
      price_minor: number;
      currency: string;
      quantity: number;
      per_person_limit: number;
      sales_start: Date | null;
      sales_end: Date | null;
      hidden: boolean;
    }>(
      `select id, name, description, price_minor, currency, quantity,
              per_person_limit, sales_start, sales_end, hidden
         from ticket_types where event_slug = $1 and id = $2 for update`,
      [ticket.event_slug, input.targetTicketTypeId],
    );
    const row = typeResult.rows[0];
    if (!row || (input.actorType === "purchaser" && row.hidden)) {
      return { error: "That ticket type is not available", status: 404 } as const;
    }
    const now = Date.now();
    if (
      input.actorType === "purchaser" &&
      ((row.sales_start && row.sales_start.getTime() > now) ||
        (row.sales_end && row.sales_end.getTime() <= now))
    ) {
      return { error: "That ticket type is not on sale right now", status: 409 } as const;
    }
    const currentCurrency = ticket.currency ?? row.currency;
    if (row.currency.toLowerCase() !== currentCurrency.toLowerCase()) {
      return {
        error: "Ticket types with different currencies cannot be exchanged",
        status: 409,
      } as const;
    }

    const countResult = await client.query<{ sold: string }>(
      `select count(*)::text as sold from tickets
        where event_slug = $1 and ticket_type_id = $2 and status = 'valid'`,
      [ticket.event_slug, row.id],
    );
    const sold = Number(countResult.rows[0]?.sold ?? 0);
    const checkoutReserved = await countCheckoutHolds(client, {
      eventSlug: ticket.event_slug,
      ticketTypeId: row.id,
    });
    const exchangeReserved = await countExchangeHolds(client, {
      eventSlug: ticket.event_slug,
      ticketTypeId: row.id,
    });
    if (sold + checkoutReserved + exchangeReserved >= row.quantity) {
      return { error: `${row.name} is sold out`, status: 409 } as const;
    }
    const heldResult = await client.query<{ held: string }>(
      input.actorType === "purchaser" && ticket.email_hash
        ? `select count(*)::text as held from tickets
            where event_slug = $1 and ticket_type_id = $2
              and email_hash = $3 and status = 'valid'`
        : `select count(*)::text as held from tickets
            where event_slug = $1 and ticket_type_id = $2
              and order_id = $3 and status = 'valid'`,
      [ticket.event_slug, row.id, ticket.email_hash ?? ticket.order_id],
    );
    const checkoutPersonHeld = ticket.email_hash
      ? await countCheckoutHolds(client, {
          eventSlug: ticket.event_slug,
          ticketTypeId: row.id,
          emailHash: ticket.email_hash,
        })
      : 0;
    const exchangePersonHeld = await countExchangeHolds(client, {
      eventSlug: ticket.event_slug,
      ticketTypeId: row.id,
      ...(ticket.email_hash ? { emailHash: ticket.email_hash } : { orderId: ticket.order_id }),
    });
    if (
      Number(heldResult.rows[0]?.held ?? 0) + checkoutPersonHeld + exchangePersonHeld + 1 >
      row.per_person_limit
    ) {
      return {
        error: `Limit of ${row.per_person_limit} per ${input.actorType === "purchaser" ? "person" : "order"} for ${row.name}`,
        status: 409,
      } as const;
    }

    const id = exchangeId();
    const amountDelta = row.price_minor - (ticket.amount_paid_minor ?? 0);
    const inserted = await client.query<ExchangeRow>(
      `insert into ticket_exchanges (
         id, event_slug, order_id, ticket_id, from_ticket_type_id, to_ticket_type_id,
         actor_type, status, amount_delta_minor, currency
       ) values ($1,$2,$3,$4,$5,$6,$7,'processing',$8,$9)
       returning *`,
      [
        id,
        ticket.event_slug,
        ticket.order_id,
        ticket.id,
        ticket.ticket_type_id,
        row.id,
        input.actorType,
        amountDelta,
        row.currency,
      ],
    );
    const target: TicketType = {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      priceMinor: row.price_minor,
      currency: row.currency,
      quantity: row.quantity,
      perPersonLimit: row.per_person_limit,
      salesStart: row.sales_start?.toISOString(),
      salesEnd: row.sales_end?.toISOString(),
      hidden: row.hidden,
    };
    return { exchange: inserted.rows[0], ticket, target } as const;
  });

  if (
    "error" in event &&
    typeof event.error === "string" &&
    "status" in event &&
    typeof event.status === "number"
  ) {
    return { ok: false, status: event.status, error: event.error };
  }
  return { ok: true, value: event };
}

async function completeExchange(client: PoolClient, exchange: ExchangeRow): Promise<void> {
  const updated = await client.query(
    `update tickets
        set ticket_type_id = $2, amount_paid_minor = coalesce(amount_paid_minor, 0) + $3
      where id = $1 and ticket_type_id = $4 and status = 'valid'`,
    [
      exchange.ticket_id,
      exchange.to_ticket_type_id,
      exchange.amount_delta_minor,
      exchange.from_ticket_type_id,
    ],
  );
  if (updated.rowCount === 0) {
    throw new Error("Ticket changed while its exchange was completing");
  }
  await client.query(
    `update ticket_exchanges
        set status = 'completed', completed_at = now(), updated_at = now()
      where id = $1`,
    [exchange.id],
  );
}

async function sendConfirmation(exchange: ExchangeRow, origin: string): Promise<boolean> {
  const [event, tickets] = await Promise.all([
    getEvent(exchange.event_slug),
    listTicketsForOrder(exchange.order_id),
  ]);
  if (!event || tickets.length === 0) return false;
  const changed = tickets.find((ticket) => ticket.id === exchange.ticket_id);
  const from = event.ticketTypes.find((type) => type.id === exchange.from_ticket_type_id);
  const to = event.ticketTypes.find((type) => type.id === exchange.to_ticket_type_id);
  if (!changed || !from || !to) return false;
  const manager = tickets.find((ticket) => !ticket.parentTicketId) ?? tickets[0];
  const result = await sendTicketExchangeEmail({
    event,
    tickets,
    changedTicket: changed,
    fromType: from,
    toType: to,
    amountDeltaMinor: exchange.amount_delta_minor,
    managerUrl: buildTicketUrl(origin, manager.id),
    exchangeId: exchange.id,
    source: exchange.actor_type === "admin" ? "admin" : "self-service",
  });
  return result.queued;
}

async function allocateExchangeRefunds(
  exchange: ExchangeRow,
  originalPaymentRef: string | null,
): Promise<TicketOpResult<RefundAllocation[]>> {
  const upgradePayments = await query<{ payment_ref: string }>(
    `select payment_ref from ticket_exchanges
      where order_id = $1 and status = 'completed'
        and amount_delta_minor > 0 and payment_ref is not null
      order by completed_at desc, created_at desc`,
    [exchange.order_id],
  );
  const paymentRefs = [
    ...new Set([
      ...upgradePayments.map((row) => row.payment_ref),
      ...(originalPaymentRef ? [originalPaymentRef] : []),
    ]),
  ];
  let remaining = Math.abs(exchange.amount_delta_minor);
  const allocations: RefundAllocation[] = [];
  for (const paymentIntentId of paymentRefs) {
    if (remaining === 0) break;
    const balance = await retrievePaymentBalance(paymentIntentId);
    if (!balance) {
      return { ok: false, status: 502, error: "Could not verify the refundable balance" };
    }
    const amountMinor = Math.min(remaining, balance.remainingMinor);
    if (amountMinor === 0) continue;
    allocations.push({ paymentIntentId, amountMinor });
    remaining -= amountMinor;
  }
  if (remaining > 0) {
    return {
      ok: false,
      status: 409,
      error: "The refundable payment balance is lower than this ticket's price difference",
    };
  }
  await transaction(async (client) => {
    for (const allocation of allocations) {
      await client.query(
        `insert into ticket_exchange_refunds
           (exchange_id, payment_ref, amount_minor, status)
         values ($1,$2,$3,'processing')`,
        [exchange.id, allocation.paymentIntentId, allocation.amountMinor],
      );
    }
  });
  return { ok: true, value: allocations };
}

export async function beginTicketExchange(input: {
  managerTicketId?: string;
  ticketId: string;
  targetTicketTypeId: string;
  actorType: "purchaser" | "admin";
  origin: string;
}): Promise<BeginTicketExchangeResult> {
  if (!isPaymentsConfigured()) {
    return { ok: false, status: 503, error: "Payments are not configured" };
  }
  const reserved = await reserveExchange(input);
  if (!reserved.ok) return reserved;
  const { exchange, ticket, target } = reserved.value;

  if (exchange.amount_delta_minor === 0) {
    await transaction((client) => completeExchange(client, exchange));
    const emailQueued = await sendConfirmation(exchange, input.origin);
    return {
      ok: true,
      value: {
        state: "completed",
        exchangeId: exchange.id,
        emailQueued,
        message: `${ticket.holder_name}'s ticket is now ${target.name}.`,
      },
    };
  }

  if (exchange.amount_delta_minor < 0) {
    const allocated = await allocateExchangeRefunds(exchange, ticket.payment_ref);
    if (!allocated.ok) {
      await query(
        `update ticket_exchanges set status = 'failed', error_message = $2, updated_at = now() where id = $1`,
        [exchange.id, allocated.error],
      );
      return allocated;
    }
    let pending = false;
    let refundStarted = false;
    for (const allocation of allocated.value) {
      const refund = await refundPayment({
        paymentIntentId: allocation.paymentIntentId,
        amountMinor: allocation.amountMinor,
        reference: `exchange:${exchange.id}:${allocation.paymentIntentId}`,
        metadata: {
          ticketExchangeId: exchange.id,
          ticketExchangePaymentRef: allocation.paymentIntentId,
          refundPurpose: "ticket_exchange",
        },
      });
      if (!refund.ok || refund.status === "failed" || refund.status === "canceled") {
        const message = refundStarted
          ? "Part of the refund succeeded, but Stripe could not finish it. Message us and we'll complete it."
          : refund.ok
            ? "Stripe could not process the partial refund"
            : refund.error;
        await transaction(async (client) => {
          await client.query(
            `update ticket_exchange_refunds
                set status = 'failed', updated_at = now()
              where exchange_id = $1 and payment_ref = $2`,
            [exchange.id, allocation.paymentIntentId],
          );
          await client.query(
            `update ticket_exchanges
                set status = $3, error_message = $2, updated_at = now()
              where id = $1`,
            [exchange.id, message, refundStarted ? "refund_pending" : "failed"],
          );
        });
        return { ok: false, status: 502, error: message };
      }
      const refundStatus = refund.status === "succeeded" ? "succeeded" : "pending";
      refundStarted = true;
      pending ||= refundStatus === "pending";
      await query(
        `update ticket_exchange_refunds
            set refund_ref = $3, status = $4, updated_at = now()
          where exchange_id = $1 and payment_ref = $2`,
        [exchange.id, allocation.paymentIntentId, refund.refundId, refundStatus],
      );
    }
    if (pending) {
      await query(
        `update ticket_exchanges set status = 'refund_pending', updated_at = now() where id = $1`,
        [exchange.id],
      );
      return {
        ok: true,
        value: {
          state: "refund_pending",
          exchangeId: exchange.id,
          message: "The change will complete as soon as Stripe confirms the partial refund.",
        },
      };
    }
    const current = await queryOne<ExchangeRow>(`select * from ticket_exchanges where id = $1`, [
      exchange.id,
    ]);
    if (current?.status !== "completed") {
      await transaction((client) => completeExchange(client, exchange));
    }
    const emailQueued = await sendConfirmation(exchange, input.origin);
    return {
      ok: true,
      value: {
        state: "completed",
        exchangeId: exchange.id,
        emailQueued,
        message: `${ticket.holder_name}'s ticket is now ${target.name}. ${formatMoney(
          Math.abs(exchange.amount_delta_minor),
          exchange.currency,
        )} is going back to the original payment method.`,
      },
    };
  }

  if (!isCheckoutTotalSupported(exchange.amount_delta_minor, 1, exchange.currency)) {
    const minimum = getCheckoutMinimumMinor(exchange.currency);
    await query(
      `update ticket_exchanges set status = 'cancelled', updated_at = now() where id = $1`,
      [exchange.id],
    );
    return {
      ok: false,
      status: 409,
      error: minimum
        ? `The price difference must be at least ${formatMoney(minimum, exchange.currency)}`
        : "That price difference is too low for online payment",
    };
  }

  let session: { id: string; url: string };
  if (!ticket.email) {
    await query(
      `update ticket_exchanges set status = 'cancelled', updated_at = now() where id = $1`,
      [exchange.id],
    );
    return { ok: false, status: 409, error: "Add an email address before creating a payment link" };
  }
  try {
    session = await createCheckoutSession({
      eventTitle: (await getEvent(exchange.event_slug))?.title ?? "Ticket change",
      ticketTypeName: `change to ${target.name}`,
      priceMinor: exchange.amount_delta_minor,
      currency: exchange.currency,
      quantity: 1,
      email: ticket.email ?? "",
      successUrl: `${buildTicketUrl(input.origin, input.managerTicketId ?? ticket.id)}?exchange=${exchange.id}&session={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${buildTicketUrl(input.origin, input.managerTicketId ?? ticket.id)}?exchange=cancelled`,
      metadata: {
        checkoutReference: exchange.id,
        checkoutPurpose: "ticket_exchange",
        ticketExchangeId: exchange.id,
        ticketId: ticket.id,
        orderId: ticket.order_id,
      },
      reference: exchange.id,
    });
  } catch (error) {
    log.error(
      "tickets.exchange",
      "Could not create exchange checkout",
      { exchangeId: exchange.id },
      error,
    );
    await query(
      `update ticket_exchanges set status = 'failed', error_message = $2, updated_at = now() where id = $1`,
      [exchange.id, "Could not start checkout"],
    );
    return { ok: false, status: 502, error: "Could not start checkout. Try again." };
  }
  await query(
    `update ticket_exchanges
        set status = 'awaiting_payment', checkout_ref = $2, updated_at = now()
      where id = $1`,
    [exchange.id, session.id],
  );
  const event = await getEvent(exchange.event_slug);
  if (event) {
    await sendTicketExchangePaymentEmail({
      event,
      ticket: {
        id: ticket.id,
        holderName: ticket.holder_name,
        email: ticket.email ?? undefined,
      },
      targetType: target,
      amountMinor: exchange.amount_delta_minor,
      checkoutUrl: session.url,
      exchangeId: exchange.id,
      source: exchange.actor_type === "admin" ? "admin" : "self-service",
    });
  }
  return { ok: true, value: { state: "checkout", exchangeId: exchange.id, url: session.url } };
}

export async function fulfilTicketExchangeCheckout(
  sessionId: string,
  origin: string,
): Promise<ExchangeOutcome | null> {
  const exchange = await queryOne<ExchangeRow>(
    `select * from ticket_exchanges where checkout_ref = $1`,
    [sessionId],
  );
  if (!exchange) return null;
  if (exchange.status === "completed") {
    return { state: "complete", message: "Ticket changed.", ticketId: exchange.ticket_id };
  }
  if (exchange.status !== "awaiting_payment") {
    return activeStatus(exchange.status)
      ? { state: "pending", message: "Your ticket change is still processing." }
      : {
          state: "failed",
          message: exchange.error_message ?? "This ticket change could not be completed.",
        };
  }
  const session = await retrieveSession(sessionId);
  if (!session?.paid)
    return { state: "pending", message: "Waiting for Stripe to confirm payment." };
  if (
    session.amountMinor !== exchange.amount_delta_minor ||
    session.currency?.toLowerCase() !== exchange.currency.toLowerCase() ||
    session.metadata.ticketExchangeId !== exchange.id ||
    !session.paymentIntentId
  ) {
    await query(
      `update ticket_exchanges set status = 'failed', error_message = $2, updated_at = now() where id = $1`,
      [exchange.id, "Paid checkout did not match the exchange"],
    );
    return { state: "failed", message: "The payment did not match this ticket change." };
  }

  const claimed = await transaction(async (client) => {
    const result = await client.query<ExchangeRow>(
      `update ticket_exchanges
          set status = 'processing', payment_ref = $2, updated_at = now()
        where id = $1 and status = 'awaiting_payment'
        returning *`,
      [exchange.id, session.paymentIntentId],
    );
    const row = result.rows[0];
    if (!row) return false;
    await completeExchange(client, row);
    return true;
  });
  if (claimed)
    await sendConfirmation({ ...exchange, payment_ref: session.paymentIntentId }, origin);
  return {
    state: "complete",
    message: "Payment confirmed — the ticket has been changed.",
    ticketId: exchange.ticket_id,
  };
}

export async function expireTicketExchangeCheckout(sessionId: string): Promise<boolean> {
  const result = await query(
    `update ticket_exchanges
        set status = 'expired', updated_at = now()
      where checkout_ref = $1 and status = 'awaiting_payment'
      returning id`,
    [sessionId],
  );
  return result.length > 0;
}

export async function resolveTicketExchangeOutcome(input: {
  exchangeId: string;
  sessionId?: string;
  origin: string;
}): Promise<ExchangeOutcome> {
  if (!/^tex_[A-Za-z0-9_-]{16,64}$/.test(input.exchangeId)) return { state: "unknown" };
  if (input.sessionId) {
    const fulfilled = await fulfilTicketExchangeCheckout(input.sessionId, input.origin);
    if (fulfilled) return fulfilled;
  }
  const exchange = await queryOne<ExchangeRow>(`select * from ticket_exchanges where id = $1`, [
    input.exchangeId,
  ]);
  if (!exchange) return { state: "unknown" };
  if (exchange.status === "completed") {
    return { state: "complete", message: "Ticket changed.", ticketId: exchange.ticket_id };
  }
  if (activeStatus(exchange.status)) {
    return {
      state: "pending",
      message: exchange.error_message ?? "Your ticket change is still processing.",
    };
  }
  return {
    state: "failed",
    message: exchange.error_message ?? "This ticket change was not completed.",
  };
}

export async function completePendingExchangeRefund(
  refundId: string,
  status: string | null,
  origin: string,
  exchangeId?: string,
  paymentIntentId?: string,
): Promise<boolean> {
  const allocation = await queryOne<{ exchange_id: string; payment_ref: string }>(
    `select exchange_id, payment_ref from ticket_exchange_refunds
      where refund_ref = $1
         or ($2::text is not null and $3::text is not null
             and exchange_id = $2 and payment_ref = $3)`,
    [refundId, exchangeId ?? null, paymentIntentId ?? null],
  );
  if (!allocation) return false;
  const exchange = await queryOne<ExchangeRow>(`select * from ticket_exchanges where id = $1`, [
    allocation.exchange_id,
  ]);
  if (!exchange) return false;

  const normalizedStatus =
    status === "succeeded"
      ? "succeeded"
      : status === "failed" || status === "canceled"
        ? "failed"
        : "pending";
  await transaction(async (client) => {
    await client.query(
      `update ticket_exchange_refunds
          set refund_ref = $3, status = $4, updated_at = now()
        where exchange_id = $1 and payment_ref = $2`,
      [exchange.id, allocation.payment_ref, refundId, normalizedStatus],
    );
    if (normalizedStatus === "failed") {
      const succeeded = await client.query<{ count: string }>(
        `select count(*)::text as count from ticket_exchange_refunds
          where exchange_id = $1 and status = 'succeeded'`,
        [exchange.id],
      );
      const partiallyRefunded = Number(succeeded.rows[0]?.count ?? 0) > 0;
      await client.query(
        `update ticket_exchanges
            set status = $2, error_message = $3, updated_at = now()
          where id = $1`,
        [
          exchange.id,
          partiallyRefunded ? "refund_pending" : "failed",
          partiallyRefunded
            ? "Part of the refund succeeded, but the remainder needs attention"
            : "The partial refund failed",
        ],
      );
      return;
    }
    const remaining = await client.query<{ pending: string }>(
      `select count(*)::text as pending from ticket_exchange_refunds
        where exchange_id = $1 and status <> 'succeeded'`,
      [exchange.id],
    );
    if (Number(remaining.rows[0]?.pending ?? 0) === 0 && exchange.status !== "completed") {
      await completeExchange(client, exchange);
    }
  });
  if (normalizedStatus === "succeeded") {
    const remaining = await query<{ pending: string }>(
      `select count(*)::text as pending from ticket_exchange_refunds
        where exchange_id = $1 and status <> 'succeeded'`,
      [exchange.id],
    );
    if (Number(remaining[0]?.pending ?? 0) === 0) await sendConfirmation(exchange, origin);
  }
  return true;
}

export async function exchangeRefundTotalForPayment(paymentIntentId: string): Promise<number> {
  const rows = await query<{ amount: string }>(
    `select coalesce(sum(amount_minor), 0)::text as amount
       from ticket_exchange_refunds
      where payment_ref = $1 and status in ('processing', 'pending', 'succeeded')`,
    [paymentIntentId],
  );
  return Number(rows[0]?.amount ?? 0);
}

export async function findExchangeByPayment(paymentIntentId: string): Promise<ExchangeRow | null> {
  return queryOne<ExchangeRow>(`select * from ticket_exchanges where payment_ref = $1`, [
    paymentIntentId,
  ]);
}

async function setExchangeTicketValidity(input: {
  exchange: ExchangeRow;
  status: "valid" | "void";
  reference: string | null;
}): Promise<void> {
  await transaction(async (client) => {
    await client.query(
      `update tickets
          set status = $2, refund_ref = $3
        where id = $1 and status = $4`,
      [
        input.exchange.ticket_id,
        input.status,
        input.reference,
        input.status === "void" ? "valid" : "void",
      ],
    );
    await client.query(
      `update event_participants set status = $2, updated_at = now()
        where ticket_id = $1`,
      [input.exchange.ticket_id, input.status === "valid" ? "active" : "void"],
    );
  });
}

/** A provider-side refund of an upgrade cannot leave the upgraded QR valid. */
export async function voidExchangePaymentRefund(
  paymentIntentId: string,
  reference: string,
): Promise<boolean> {
  const exchange = await findExchangeByPayment(paymentIntentId);
  if (!exchange || exchange.status !== "completed") return false;
  await setExchangeTicketValidity({ exchange, status: "void", reference });
  await query(
    `update ticket_exchanges
        set error_message = 'The upgrade payment was refunded outside the ticket exchange flow',
            updated_at = now()
      where id = $1`,
    [exchange.id],
  );
  return true;
}

export async function voidExchangePaymentDispute(
  paymentIntentId: string,
  disputeId: string,
): Promise<boolean> {
  const exchange = await findExchangeByPayment(paymentIntentId);
  if (!exchange || exchange.status !== "completed") return false;
  await setExchangeTicketValidity({ exchange, status: "void", reference: disputeId });
  await query(`update ticket_exchanges set dispute_ref = $2, updated_at = now() where id = $1`, [
    exchange.id,
    disputeId,
  ]);
  return true;
}

export async function restoreExchangePaymentDispute(
  paymentIntentId: string,
  disputeId: string,
): Promise<boolean> {
  const exchange = await queryOne<ExchangeRow>(
    `select * from ticket_exchanges where payment_ref = $1 and dispute_ref = $2`,
    [paymentIntentId, disputeId],
  );
  if (!exchange) return false;
  await setExchangeTicketValidity({ exchange, status: "valid", reference: null });
  await query(`update ticket_exchanges set dispute_ref = null, updated_at = now() where id = $1`, [
    exchange.id,
  ]);
  return true;
}

/** Additional Stripe payments collected when tickets were upgraded. */
export async function listOrderExchangePayments(
  orderId: string,
): Promise<Array<{ exchangeId: string; paymentIntentId: string }>> {
  const rows = await query<{ id: string; payment_ref: string }>(
    `select id, payment_ref from ticket_exchanges
      where order_id = $1 and status = 'completed'
        and amount_delta_minor > 0 and payment_ref is not null
      order by completed_at desc, created_at desc`,
    [orderId],
  );
  return rows.map((row) => ({ exchangeId: row.id, paymentIntentId: row.payment_ref }));
}

/** Stop an unpaid upgrade before its order is refunded. */
export async function cancelAwaitingOrderExchanges(orderId: string): Promise<TicketOpResult<void>> {
  const active = await query<ExchangeRow>(
    `select * from ticket_exchanges
      where order_id = $1 and status in ('processing', 'awaiting_payment', 'refund_pending')
      order by created_at`,
    [orderId],
  );
  if (active.some((exchange) => exchange.status !== "awaiting_payment")) {
    return {
      ok: false,
      status: 409,
      error: "A ticket change is processing. Wait for it to finish before refunding this order.",
    };
  }
  for (const exchange of active) {
    if (!exchange.checkout_ref || !(await expireCheckoutSession(exchange.checkout_ref))) {
      return {
        ok: false,
        status: 409,
        error:
          "A ticket upgrade may already be paid. Refresh the ticket before refunding this order.",
      };
    }
    await query(
      `update ticket_exchanges set status = 'cancelled', updated_at = now()
        where id = $1 and status = 'awaiting_payment'`,
      [exchange.id],
    );
  }
  return { ok: true, value: undefined };
}
