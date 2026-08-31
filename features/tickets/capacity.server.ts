import type { PoolClient } from "pg";

import { isValidEventSlug } from "@/features/events/types";
import { query } from "@/lib/platform/postgres.server";

/** Checkout rows that still own admission capacity. */
export const ACTIVE_CHECKOUT_HOLD_SQL = `(
  (status in ('creating', 'pending') and expires_at > now())
  or status in ('payment_pending', 'fulfilling', 'payment_mismatch')
)`;

/** Exchanges keep the current ticket valid while holding their destination. */
export const ACTIVE_EXCHANGE_HOLD_SQL =
  "status in ('processing', 'awaiting_payment', 'refund_pending')";

export type TicketCapacitySnapshot = {
  sold: Record<string, number>;
  checkoutReserved: Record<string, number>;
  exchangeReserved: Record<string, number>;
};

type CapacityRow = {
  event_slug: string;
  source: "sold" | "checkout" | "exchange";
  ticket_type_id: string;
  quantity: string;
};

const CAPACITY_SNAPSHOT_SQL = `
  select event_slug, 'sold'::text as source, ticket_type_id, count(*)::text as quantity
    from tickets
   where event_slug = any($1::text[]) and status = 'valid'
   group by event_slug, ticket_type_id
  union all
  select event_slug, 'checkout'::text as source, ticket_type_id,
         sum(quantity)::text as quantity
    from checkout_sessions
   where event_slug = any($1::text[]) and ${ACTIVE_CHECKOUT_HOLD_SQL}
   group by event_slug, ticket_type_id
  union all
  select event_slug, 'exchange'::text as source, to_ticket_type_id as ticket_type_id,
         count(*)::text as quantity
    from ticket_exchanges
   where event_slug = any($1::text[]) and ${ACTIVE_EXCHANGE_HOLD_SQL}
   group by event_slug, to_ticket_type_id
`;

function emptySnapshot(): TicketCapacitySnapshot {
  return { sold: {}, checkoutReserved: {}, exchangeReserved: {} };
}

function addCount(snapshot: TicketCapacitySnapshot, row: CapacityRow): void {
  const count = Number.parseInt(row.quantity, 10) || 0;
  const target =
    row.source === "sold"
      ? snapshot.sold
      : row.source === "checkout"
        ? snapshot.checkoutReserved
        : snapshot.exchangeReserved;
  target[row.ticket_type_id] = count;
}

/**
 * One read model for every capacity display.
 *
 * Issuance still rechecks under row locks; this snapshot makes public, ticket,
 * admin, and metadata surfaces agree without pretending a display read is a lock.
 */
export async function getTicketCapacitySnapshot(slug: string): Promise<TicketCapacitySnapshot> {
  if (!isValidEventSlug(slug)) return emptySnapshot();
  return (await getTicketCapacitySnapshots([slug]))[slug] ?? emptySnapshot();
}

export async function getTicketCapacitySnapshots(
  slugs: string[],
): Promise<Record<string, TicketCapacitySnapshot>> {
  const safe = [...new Set(slugs.filter(isValidEventSlug))];
  if (safe.length === 0) return {};
  const rows = await query<CapacityRow>(CAPACITY_SNAPSHOT_SQL, [safe]);
  const snapshots = Object.fromEntries(safe.map((slug) => [slug, emptySnapshot()]));
  for (const row of rows) addCount(snapshots[row.event_slug], row);
  return snapshots;
}

/** Capacity read on a caller-owned transaction, used after locking an event row. */
export async function getTicketCapacitySnapshotWithClient(
  client: PoolClient,
  slug: string,
): Promise<TicketCapacitySnapshot> {
  if (!isValidEventSlug(slug)) return emptySnapshot();
  const result = await client.query<CapacityRow>(CAPACITY_SNAPSHOT_SQL, [[slug]]);
  const snapshot = emptySnapshot();
  for (const row of result.rows) addCount(snapshot, row);
  return snapshot;
}

export async function countCheckoutHolds(
  client: PoolClient,
  input: {
    eventSlug: string;
    ticketTypeId?: string;
    emailHash?: string;
    excludeReference?: string;
  },
): Promise<number> {
  const result = await client.query<{ quantity: string }>(
    `select coalesce(sum(quantity), 0)::text as quantity
       from checkout_sessions
      where event_slug = $1
        and ($2::text is null or ticket_type_id = $2)
        and ($3::text is null or email_hash = $3)
        and ($4::text is null or reference is distinct from $4)
        and ${ACTIVE_CHECKOUT_HOLD_SQL}`,
    [
      input.eventSlug,
      input.ticketTypeId ?? null,
      input.emailHash ?? null,
      input.excludeReference ?? null,
    ],
  );
  return Number(result.rows[0]?.quantity ?? 0);
}

export async function countExchangeHolds(
  client: PoolClient,
  input: {
    eventSlug: string;
    ticketTypeId?: string;
    emailHash?: string;
    orderId?: string;
    excludeExchangeId?: string;
  },
): Promise<number> {
  const result = await client.query<{ quantity: string }>(
    `select count(*)::text as quantity
       from ticket_exchanges exchange
       join tickets ticket on ticket.id = exchange.ticket_id
      where exchange.event_slug = $1
        and ($2::text is null or exchange.to_ticket_type_id = $2)
        and ($3::text is null or ticket.email_hash = $3)
        and ($4::text is null or exchange.order_id = $4)
        and ($5::text is null or exchange.id <> $5)
        and exchange.${ACTIVE_EXCHANGE_HOLD_SQL}`,
    [
      input.eventSlug,
      input.ticketTypeId ?? null,
      input.emailHash ?? null,
      input.orderId ?? null,
      input.excludeExchangeId ?? null,
    ],
  );
  return Number(result.rows[0]?.quantity ?? 0);
}
