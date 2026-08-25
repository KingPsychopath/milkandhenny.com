import type { PoolClient } from "pg";

import { log } from "@/lib/platform/logger.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import { isValidEventSlug } from "@/features/events/types";
import { isValidTicketId, type TicketKind, type TicketRecord, type TicketStatus } from "./types";

/**
 * Ticket persistence.
 *
 * Two invariants live here and are enforced by the database rather than by
 * application care:
 *
 * - **Capacity.** Issuance locks the ticket-type row, counts live tickets,
 *   and inserts inside one transaction. Two buyers racing for the last seat
 *   serialise behind the lock, so overselling is not possible. "Sold" is a
 *   count of rows, never a counter that can drift from them.
 * - **Single admission.** Redemption is `update ... where redeemed_at is null
 *   returning *`. The second scanner gets zero rows back. No claim key, no
 *   read-modify-write.
 */

type TicketRow = {
  id: string;
  event_slug: string;
  ticket_type_id: string;
  kind: string;
  status: string;
  holder_name: string;
  email: string | null;
  email_hash: string | null;
  order_id: string;
  parent_ticket_id: string | null;
  issued_at: Date;
  redeemed_at: Date | null;
  redeemed_by: string | null;
  redeemed_offline: boolean | null;
  payment_ref: string | null;
  checkout_ref: string | null;
  amount_paid_minor: number | null;
  currency: string | null;
  refunded_at: Date | null;
  refund_ref: string | null;
  notes: string | null;
};

function optional(value: string | null): string | undefined {
  return value === null ? undefined : value;
}

function toTicket(row: TicketRow): TicketRecord {
  return {
    id: row.id,
    eventSlug: row.event_slug,
    ticketTypeId: row.ticket_type_id,
    kind: row.kind as TicketKind,
    status: row.status as TicketStatus,
    holderName: row.holder_name,
    email: optional(row.email),
    emailHash: optional(row.email_hash),
    orderId: row.order_id,
    parentTicketId: optional(row.parent_ticket_id),
    issuedAt: row.issued_at.toISOString(),
    redeemedAt: row.redeemed_at?.toISOString(),
    redeemedBy: optional(row.redeemed_by),
    redeemedOffline: row.redeemed_offline ?? undefined,
    paymentRef: optional(row.payment_ref),
    amountPaidMinor: row.amount_paid_minor ?? undefined,
    currency: optional(row.currency),
    refundedAt: row.refunded_at?.toISOString(),
    refundRef: optional(row.refund_ref),
    notes: optional(row.notes),
  };
}

export async function getTicket(id: string): Promise<TicketRecord | null> {
  if (!isValidTicketId(id)) return null;
  const rows = await query<TicketRow>(`select * from tickets where id = $1`, [id]);
  return rows[0] ? toTicket(rows[0]) : null;
}

export async function getTickets(ids: string[]): Promise<TicketRecord[]> {
  const safe = ids.filter(isValidTicketId);
  if (safe.length === 0) return [];
  const rows = await query<TicketRow>(
    `select * from tickets where id = any($1::text[]) order by issued_at`,
    [safe],
  );
  return rows.map(toTicket);
}

export async function listTicketsForEvent(slug: string): Promise<TicketRecord[]> {
  if (!isValidEventSlug(slug)) return [];
  const rows = await query<TicketRow>(
    `select * from tickets where event_slug = $1 order by holder_name`,
    [slug],
  );
  return rows.map(toTicket);
}

export async function listTicketsForEmail(
  slug: string,
  emailHash: string,
): Promise<TicketRecord[]> {
  if (!isValidEventSlug(slug) || !emailHash) return [];
  const rows = await query<TicketRow>(
    `select * from tickets
      where event_slug = $1 and email_hash = $2 and status = 'valid'
      order by issued_at`,
    [slug, emailHash],
  );
  return rows.map(toTicket);
}

export async function listTicketsForOrder(orderId: string): Promise<TicketRecord[]> {
  if (!orderId) return [];
  const rows = await query<TicketRow>(
    `select * from tickets
      where order_id = $1
      order by (parent_ticket_id is not null), issued_at, id`,
    [orderId],
  );
  return rows.map(toTicket);
}

export async function listTicketsForCheckout(checkoutRef: string): Promise<TicketRecord[]> {
  if (!checkoutRef) return [];
  const rows = await query<TicketRow>(
    `select * from tickets where checkout_ref = $1 order by issued_at`,
    [checkoutRef],
  );
  return rows.map(toTicket);
}

export async function listRefundedTicketsForPayment(
  paymentRef: string,
  refundRef: string,
): Promise<TicketRecord[]> {
  const rows = await query<TicketRow>(
    `select * from tickets
      where payment_ref = $1 and status = 'refunded' and refund_ref = $2
      order by issued_at, id`,
    [paymentRef, refundRef],
  );
  return rows.map(toTicket);
}

/** Live sold counts per ticket type — a count of rows, not a stored counter. */
export async function getSoldCounts(slug: string): Promise<Record<string, number>> {
  if (!isValidEventSlug(slug)) return {};
  const rows = await query<{ ticket_type_id: string; sold: string }>(
    `select ticket_type_id, count(*)::text as sold
       from tickets
      where event_slug = $1 and status = 'valid'
      group by ticket_type_id`,
    [slug],
  );
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.ticket_type_id] = Number.parseInt(row.sold, 10) || 0;
  return counts;
}

export type NewTicket = {
  id: string;
  holderName: string;
  parentTicketId?: string;
};

export type IssueInput = {
  eventSlug: string;
  ticketTypeId: string;
  kind: TicketKind;
  orderId: string;
  email?: string;
  emailHash?: string;
  paymentRef?: string;
  checkoutRef?: string;
  amountPaidMinor?: number;
  currency?: string;
  notes?: string;
  /** Staff comping past a closed sales window or a full house. */
  ignoreCapacity?: boolean;
};

export type IssueOutcome =
  | { ok: true; tickets: TicketRecord[] }
  | { ok: false; reason: "sold-out"; remaining: number }
  | { ok: false; reason: "per-person-limit"; limit: number }
  | { ok: false; reason: "unknown-type" };

/**
 * Insert tickets, enforcing capacity under a row lock.
 *
 * `select ... for update` on the ticket-type row is what serialises
 * concurrent buyers: the second transaction blocks until the first commits,
 * then sees the updated count.
 */
export async function insertTicketsWithCapacity(
  input: IssueInput,
  newTickets: NewTicket[],
): Promise<IssueOutcome> {
  return transaction(async (client) => {
    // Lock the event before its ticket type. Every issuance takes locks in
    // this order, so ticket types selling concurrently cannot exceed the
    // room-wide cap or deadlock each other.
    const eventResult = await client.query<{ capacity: number | null }>(
      `select capacity from events where slug = $1 for update`,
      [input.eventSlug],
    );
    const event = eventResult.rows[0];
    if (!event) return { ok: false as const, reason: "unknown-type" as const };

    const typeResult = await client.query<{ quantity: number; per_person_limit: number }>(
      `select quantity, per_person_limit from ticket_types
        where event_slug = $1 and id = $2
        for update`,
      [input.eventSlug, input.ticketTypeId],
    );
    const ticketType = typeResult.rows[0];
    if (!ticketType) return { ok: false as const, reason: "unknown-type" as const };

    if (!input.ignoreCapacity) {
      if (input.emailHash) {
        const heldResult = await client.query<{ held: string }>(
          `select count(*)::text as held from tickets
            where event_slug = $1 and ticket_type_id = $2
              and email_hash = $3 and status = 'valid'`,
          [input.eventSlug, input.ticketTypeId, input.emailHash],
        );
        const held = Number.parseInt(heldResult.rows[0]?.held ?? "0", 10);
        if (held + newTickets.length > ticketType.per_person_limit) {
          return {
            ok: false as const,
            reason: "per-person-limit" as const,
            limit: ticketType.per_person_limit,
          };
        }
      }

      const soldResult = await client.query<{ sold: string }>(
        `select count(*)::text as sold from tickets
          where event_slug = $1 and ticket_type_id = $2 and status = 'valid'`,
        [input.eventSlug, input.ticketTypeId],
      );
      const sold = Number.parseInt(soldResult.rows[0]?.sold ?? "0", 10);
      // An exchange keeps its current seat while reserving the destination.
      // Count those short-lived reservations here so a normal checkout cannot
      // take a place after someone has started paying the price difference.
      const reservedResult = await client.query<{ reserved: string }>(
        `select count(*)::text as reserved from ticket_exchanges
          where event_slug = $1 and to_ticket_type_id = $2
            and status in ('processing', 'awaiting_payment', 'refund_pending')`,
        [input.eventSlug, input.ticketTypeId],
      );
      const reserved = Number.parseInt(reservedResult.rows[0]?.reserved ?? "0", 10);
      const typeRemaining = Math.max(0, ticketType.quantity - sold - reserved);
      let eventRemaining = Number.POSITIVE_INFINITY;
      if (event.capacity !== null) {
        const eventSoldResult = await client.query<{ sold: string }>(
          `select count(*)::text as sold from tickets
            where event_slug = $1 and status = 'valid'`,
          [input.eventSlug],
        );
        const eventSold = Number.parseInt(eventSoldResult.rows[0]?.sold ?? "0", 10);
        eventRemaining = Math.max(0, event.capacity - eventSold);
      }
      const remaining = Math.min(typeRemaining, eventRemaining);
      if (newTickets.length > remaining) {
        return { ok: false as const, reason: "sold-out" as const, remaining };
      }
    }

    const inserted: TicketRecord[] = [];
    for (const ticket of newTickets) {
      const { rows } = await client.query<TicketRow>(
        `insert into tickets (
           id, event_slug, ticket_type_id, kind, status, holder_name, email, email_hash,
           order_id, parent_ticket_id, payment_ref, checkout_ref, amount_paid_minor,
           currency, notes
         ) values ($1,$2,$3,$4,'valid',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         returning *`,
        [
          ticket.id,
          input.eventSlug,
          input.ticketTypeId,
          input.kind,
          ticket.holderName,
          input.email ?? null,
          input.emailHash ?? null,
          input.orderId,
          ticket.parentTicketId ?? null,
          input.paymentRef ?? null,
          input.checkoutRef ?? null,
          input.amountPaidMinor ?? null,
          input.currency ?? null,
          input.notes ?? null,
        ],
      );
      if (rows[0]) inserted.push(toTicket(rows[0]));
    }

    return { ok: true as const, tickets: inserted };
  });
}

export type RedeemRow =
  | { claimed: true; ticket: TicketRecord }
  | { claimed: false; ticket: TicketRecord | null };

/**
 * Claim a ticket for entry.
 *
 * The `where redeemed_at is null` predicate is the single-use guarantee.
 * Two simultaneous scans both run this statement; exactly one updates a row.
 */
export async function claimRedemption(
  id: string,
  redeemedBy: string | undefined,
  offline: boolean,
): Promise<RedeemRow> {
  if (!isValidTicketId(id)) return { claimed: false, ticket: null };

  const claimed = await transaction(async (client) => {
    const result = await client.query<TicketRow>(
      `update tickets
          set redeemed_at = now(),
              redeemed_by = $2,
              redeemed_offline = $3
        where id = $1 and redeemed_at is null and status = 'valid'
        returning *`,
      [id, redeemedBy ?? null, offline ? true : null],
    );
    if (result.rows[0]) {
      await client.query(
        `update event_participants
            set checked_in_at = coalesce(checked_in_at, now()), updated_at = now()
          where ticket_id = $1 and status = 'active'`,
        [id],
      );
    }
    return result.rows;
  });

  if (claimed[0]) return { claimed: true, ticket: toTicket(claimed[0]) };

  const existing = await query<TicketRow>(`select * from tickets where id = $1`, [id]);
  return { claimed: false, ticket: existing[0] ? toTicket(existing[0]) : null };
}

/**
 * Correct a holder's details — a typo'd name, a wrong or changed email.
 * `email: null` clears the address; `undefined` leaves it alone.
 */
export async function updateTicketHolder(
  id: string,
  changes: { holderName?: string; email?: string | null },
): Promise<TicketRecord | null> {
  if (!isValidTicketId(id)) return null;
  const { hashEmail } = await import("./qr.server");
  const { normaliseEmail } = await import("./types");

  const setEmail = changes.email !== undefined;
  const email = changes.email ? normaliseEmail(changes.email) : null;
  const row = await transaction(async (client) => {
    const result = await client.query<TicketRow>(
      `update tickets
          set holder_name = coalesce($2, holder_name),
              email = case when $3 then $4 else email end,
              email_hash = case when $3 then $5 else email_hash end
        where id = $1
        returning *`,
      [id, changes.holderName ?? null, setEmail, email, email ? hashEmail(email) : null],
    );
    const updated = result.rows[0];
    if (updated && changes.holderName !== undefined) {
      await client.query(
        `update event_participants
            set display_name = $2, updated_at = now()
          where ticket_id = $1`,
        [id, updated.holder_name],
      );
    }
    return updated ?? null;
  });
  if (row) log.info("tickets.update", "Holder details changed", { id });
  return row ? toTicket(row) : null;
}

/** Staff correction: someone scanned the wrong phone. */
export async function releaseRedemption(id: string): Promise<void> {
  if (!isValidTicketId(id)) return;
  await query(
    `update tickets set redeemed_at = null, redeemed_by = null, redeemed_offline = null
      where id = $1`,
    [id],
  );
}

/**
 * Mark a ticket void or refunded.
 *
 * Capacity is released implicitly: `getSoldCounts` only counts `valid` rows,
 * so a refund puts the seat back without a second write that could fail
 * independently.
 */
export async function markTicketStatus(
  id: string,
  status: Exclude<TicketStatus, "valid">,
  refundRef?: string,
): Promise<TicketRecord | null> {
  if (!isValidTicketId(id)) return null;
  const ticket = await transaction(async (client) => {
    const rows = await client.query<TicketRow>(
      `update tickets
          set status = $2,
              refunded_at = case when $2 = 'refunded' then now() else refunded_at end,
              refund_ref = coalesce($3, refund_ref)
        where id = $1
        returning *`,
      [id, status, refundRef ?? null],
    );
    const updated = rows.rows[0];
    if (!updated) return null;
    await client.query(
      `update event_participants set status = $2, updated_at = now()
        where ticket_id = $1`,
      [id, status === "refunded" ? "refunded" : "void"],
    );
    return toTicket(updated);
  });
  if (ticket) log.info("tickets.status", "Ticket status changed", { id, status });
  return ticket;
}

/** Refund every ticket in an order — used by the Stripe refund webhook. */
export async function markOrderRefunded(
  paymentRef: string,
  refundRef: string,
  amountRefundedMinor?: number,
): Promise<TicketRecord[]> {
  return transaction(async (client) => {
    const { rows: order } = await client.query<TicketRow>(
      `select * from tickets
        where payment_ref = $1
        order by issued_at, id
        for update`,
      [paymentRef],
    );
    if (order.length === 0) return [];

    // `charge.amount_refunded` is cumulative. Always calculate its coverage
    // against the complete order, including tickets handled by an earlier
    // partial refund. Calculating against only live tickets makes a second
    // partial refund void too many tickets.
    let covered = order;
    if (typeof amountRefundedMinor === "number" && amountRefundedMinor > 0) {
      const total = order.reduce((sum, row) => sum + (row.amount_paid_minor ?? 0), 0);
      if (amountRefundedMinor < total) {
        covered = [];
        let remaining = amountRefundedMinor;
        for (const row of order) {
          const price = row.amount_paid_minor ?? 0;
          if (price <= 0 || price > remaining) break;
          remaining -= price;
          covered.push(row);
        }
      }
    }

    const toRefund = covered.filter((row) => row.status !== "refunded");
    if (toRefund.length === 0) return [];

    const { rows } = await client.query<TicketRow>(
      `update tickets
          set status = 'refunded', refunded_at = now(), refund_ref = $2
        where id = any($1::text[])
        returning *`,
      [toRefund.map((row) => row.id), refundRef],
    );
    await client.query(
      `update event_participants set status = 'refunded', updated_at = now()
        where ticket_id = any($1::text[])`,
      [toRefund.map((row) => row.id)],
    );
    return rows.map(toTicket);
  });
}

/** Stop an order at the door while Stripe is still processing its refund. */
export async function markOrderRefundPending(
  paymentRef: string,
  refundRef: string,
): Promise<TicketRecord[]> {
  return transaction(async (client) => {
    const rows = await client.query<TicketRow>(
      `update tickets
          set status = 'void', refund_ref = $2
        where payment_ref = $1 and status = 'valid'
        returning *`,
      [paymentRef, refundRef],
    );
    await client.query(
      `update event_participants set status = 'void', updated_at = now()
        where ticket_id = any($1::text[])`,
      [rows.rows.map((row) => row.id)],
    );
    return rows.rows.map(toTicket);
  });
}

/** Invalidate every QR while a multi-payment order refund is settling. */
export async function markTicketOrderRefundPending(
  orderId: string,
  refundRef: string,
): Promise<TicketRecord[]> {
  return transaction(async (client) => {
    const { rows } = await client.query<TicketRow>(
      `update tickets set status = 'void', refund_ref = $2
        where order_id = $1 and status = 'valid'
        returning *`,
      [orderId, refundRef],
    );
    await client.query(
      `update event_participants set status = 'void', updated_at = now()
        where ticket_id = any($1::text[])`,
      [rows.map((row) => row.id)],
    );
    return rows.map(toTicket);
  });
}

/** Finish a refund for an order funded by its purchase plus exchange payments. */
export async function markTicketOrderRefunded(
  orderId: string,
  refundRef: string,
): Promise<TicketRecord[]> {
  return transaction(async (client) => {
    const { rows } = await client.query<TicketRow>(
      `update tickets
          set status = 'refunded', refunded_at = now(), refund_ref = $2
        where order_id = $1 and status <> 'refunded'
        returning *`,
      [orderId, refundRef],
    );
    await client.query(
      `update event_participants set status = 'refunded', updated_at = now()
        where ticket_id = any($1::text[])`,
      [rows.map((row) => row.id)],
    );
    return rows.map(toTicket);
  });
}

/** Keep failed-refund tickets invalid until staff repays the buyer another way. */
export async function markRefundFailed(refundRef: string): Promise<TicketRecord[]> {
  return transaction(async (client) => {
    const rows = await client.query<TicketRow>(
      `update tickets
          set status = 'void', refunded_at = null
        where refund_ref = $1 and status = 'refunded'
        returning *`,
      [refundRef],
    );
    await client.query(
      `update event_participants set status = 'void', updated_at = now()
        where ticket_id = any($1::text[])`,
      [rows.rows.map((row) => row.id)],
    );
    return rows.rows.map(toTicket);
  });
}

/**
 * Void an order because a chargeback was opened.
 *
 * Deliberately distinct from a refund: the ticket becomes `void`, not
 * `refunded`, and `refunded_at` stays null because no money has been
 * returned — the bank is holding it pending the outcome. That distinction is
 * what makes the dispute reversible if it is later won.
 */
export async function markOrderDisputed(
  paymentRef: string,
  disputeRef: string,
): Promise<TicketRecord[]> {
  return transaction(async (client) => {
    const rows = await client.query<TicketRow>(
      `update tickets
          set status = 'void', refund_ref = $2
        where payment_ref = $1 and status = 'valid'
        returning *`,
      [paymentRef, disputeRef],
    );
    await client.query(
      `update event_participants set status = 'void', updated_at = now()
        where ticket_id = any($1::text[])`,
      [rows.rows.map((row) => row.id)],
    );
    return rows.rows.map(toTicket);
  });
}

/**
 * Restore tickets voided by a dispute that was later won.
 *
 * Only reverses a dispute-driven void: a genuine refund sets `refunded_at`,
 * and money that went back should stay gone.
 */
export async function restoreDisputedTickets(
  paymentRef: string,
  disputeRef: string,
): Promise<TicketRecord[]> {
  return transaction(async (client) => {
    const rows = await client.query<TicketRow>(
      `update tickets
          set status = 'valid', refund_ref = null
        where payment_ref = $1 and status = 'void'
          and refund_ref = $2 and refunded_at is null
        returning *`,
      [paymentRef, disputeRef],
    );
    await client.query(
      `update event_participants set status = 'active', updated_at = now()
        where ticket_id = any($1::text[])`,
      [rows.rows.map((row) => row.id)],
    );
    return rows.rows.map(toTicket);
  });
}

/** Valid, unredeemed-or-redeemed ticket ids for the offline door manifest. */
export async function listValidTicketIds(slug: string): Promise<string[]> {
  if (!isValidEventSlug(slug)) return [];
  const rows = await query<{ id: string }>(
    `select id from tickets where event_slug = $1 and status = 'valid'`,
    [slug],
  );
  return rows.map((row) => row.id);
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return transaction(fn);
}
