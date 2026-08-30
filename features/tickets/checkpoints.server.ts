import { log } from "@/lib/platform/logger.server";
import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import { isValidEventSlug } from "@/features/events/types";
import { getEvent } from "@/features/events/store.server";
import {
  checkpointAllowanceFor,
  isValidCheckpointId,
  type CheckpointGroupView,
  type CheckpointRecord,
  type CheckpointScanOutcome,
  type CheckpointTicketView,
} from "./checkpoint-types";
import { verifyTicketSignature } from "./qr.server";
import { isValidTicketId, parseTicketQrPayload } from "./types";
import type { TicketOpResult } from "./tickets.server";

/**
 * Checkpoint scanning.
 *
 * The same QR that admits someone at the door is scanned again at a
 * checkpoint, but instead of a single admission it draws down a counted
 * allowance — "this ticket includes two meals". Consumption is a guarded
 * upsert, so two stations scanning the same ticket at once cannot hand out
 * more than the allowance between them.
 *
 * Deliberately independent of door redemption: someone can collect food
 * before the door scan is fixed up, and voiding a ticket kills both.
 */

type CheckpointRow = {
  event_slug: string;
  id: string;
  name: string;
  default_allowance: number;
  allowances: unknown;
  multi_scan: boolean;
  position: number;
};

function toCheckpoint(row: CheckpointRow): CheckpointRecord {
  const allowances: Record<string, number> = {};
  if (row.allowances && typeof row.allowances === "object" && !Array.isArray(row.allowances)) {
    for (const [key, value] of Object.entries(row.allowances as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
        allowances[key] = value;
      }
    }
  }
  return {
    eventSlug: row.event_slug,
    id: row.id,
    name: row.name,
    defaultAllowance: row.default_allowance,
    allowances,
    multiScan: row.multi_scan !== false,
    position: row.position,
  };
}

export async function listCheckpoints(eventSlug: string): Promise<CheckpointRecord[]> {
  if (!isValidEventSlug(eventSlug)) return [];
  const rows = await query<CheckpointRow>(
    `select event_slug, id, name, default_allowance, allowances, multi_scan, position
       from checkpoints where event_slug = $1 order by position, id`,
    [eventSlug],
  );
  return rows.map(toCheckpoint);
}

export async function getCheckpoint(
  eventSlug: string,
  checkpointId: string,
): Promise<CheckpointRecord | null> {
  if (!isValidEventSlug(eventSlug) || !isValidCheckpointId(checkpointId)) return null;
  const row = await queryOne<CheckpointRow>(
    `select event_slug, id, name, default_allowance, allowances, multi_scan, position
       from checkpoints where event_slug = $1 and id = $2`,
    [eventSlug, checkpointId],
  );
  return row ? toCheckpoint(row) : null;
}

export type UpsertCheckpointInput = {
  eventSlug: string;
  id: string;
  name: string;
  defaultAllowance: number;
  allowances: Record<string, number>;
  multiScan?: boolean;
  position?: number;
};

export async function upsertCheckpoint(
  input: UpsertCheckpointInput,
): Promise<TicketOpResult<CheckpointRecord>> {
  const name = input.name?.trim();
  if (!name) return { ok: false, status: 400, error: "A checkpoint needs a name" };
  if (name.length > 60) return { ok: false, status: 400, error: "That name is too long" };
  if (!isValidCheckpointId(input.id)) {
    return { ok: false, status: 400, error: "Checkpoint id must be a short slug" };
  }
  const allowance = Math.round(input.defaultAllowance);
  if (!Number.isFinite(allowance) || allowance < 0 || allowance > 100) {
    return { ok: false, status: 400, error: "Allowance must be between 0 and 100" };
  }

  const event = await getEvent(input.eventSlug);
  if (!event) return { ok: false, status: 404, error: "Event not found" };

  const validTypeIds = new Set(event.ticketTypes.map((type) => type.id));
  const allowances: Record<string, number> = {};
  for (const [typeId, value] of Object.entries(input.allowances ?? {})) {
    if (!validTypeIds.has(typeId)) continue;
    const units = Math.round(value);
    if (Number.isFinite(units) && units >= 0 && units <= 100) allowances[typeId] = units;
  }

  const row = await queryOne<CheckpointRow>(
    `insert into checkpoints (event_slug, id, name, default_allowance, allowances, multi_scan, position)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7)
     on conflict (event_slug, id) do update
       set name = excluded.name,
           default_allowance = excluded.default_allowance,
           allowances = excluded.allowances,
           multi_scan = excluded.multi_scan,
           position = excluded.position
     returning event_slug, id, name, default_allowance, allowances, multi_scan, position`,
    [
      input.eventSlug,
      input.id,
      name,
      allowance,
      JSON.stringify(allowances),
      input.multiScan !== false,
      Math.round(input.position ?? 0),
    ],
  );
  if (!row) return { ok: false, status: 500, error: "Failed to save checkpoint" };

  log.info("checkpoints.upsert", "Checkpoint saved", { slug: input.eventSlug, id: input.id });
  return { ok: true, value: toCheckpoint(row) };
}

/** Usage history dies with the checkpoint — cascade is intentional. */
export async function deleteCheckpoint(
  eventSlug: string,
  checkpointId: string,
): Promise<TicketOpResult<void>> {
  if (!isValidEventSlug(eventSlug) || !isValidCheckpointId(checkpointId)) {
    return { ok: false, status: 400, error: "Unknown checkpoint" };
  }
  await query(`delete from checkpoints where event_slug = $1 and id = $2`, [
    eventSlug,
    checkpointId,
  ]);
  log.info("checkpoints.delete", "Checkpoint deleted", { slug: eventSlug, id: checkpointId });
  return { ok: true, value: undefined };
}

export type CheckpointScanInput = {
  /** Raw scanned payload, or a bare ticket id typed in as a fallback. */
  scanned: string;
  eventSlug: string;
  checkpointId: string;
  /** Units to draw down. Defaults to 1. 0 peeks without consuming. */
  consume?: number;
  scannedBy?: string;
};

/**
 * Scan a ticket at a checkpoint and draw down its allowance.
 *
 * The upsert's `where used + n <= allowance` guard is the whole integrity
 * story: concurrent scans race to it and the loser sees no row updated,
 * which reads back as "exhausted" or "over-remaining" rather than a double
 * hand-out.
 */
export async function checkpointScan(input: CheckpointScanInput): Promise<CheckpointScanOutcome> {
  const parsed = parseTicketQrPayload(input.scanned);
  const typed = input.scanned.trim().toUpperCase();
  const ticketId = parsed?.ticketId ?? (isValidTicketId(typed) ? typed : null);
  if (!ticketId) return { result: "invalid" };

  if (parsed && !verifyTicketSignature(parsed.ticketId, parsed.signature)) {
    log.warn("checkpoints.scan", "Signature rejected", { ticketId: parsed.ticketId });
    return { result: "invalid" };
  }

  let consume = Math.round(input.consume ?? 1);
  if (!Number.isFinite(consume) || consume < 0 || consume > 100) return { result: "invalid" };

  const checkpoint = await getCheckpoint(input.eventSlug, input.checkpointId);
  if (!checkpoint) return { result: "unknown-checkpoint" };
  // A single-scan station hands out exactly one, whatever was asked for.
  if (!checkpoint.multiScan && consume > 1) consume = 1;

  const ticket = await queryOne<{
    id: string;
    access_reference: string | null;
    event_slug: string;
    ticket_type_id: string;
    status: string;
    holder_name: string;
    order_id: string;
  }>(
    `select id, access_reference, event_slug, ticket_type_id, status, holder_name, order_id
       from tickets
      where access_reference = $1
         or (access_reference is null and id = $1)`,
    [ticketId],
  );
  if (!ticket) return { result: "not-found" };
  if (ticket.event_slug !== input.eventSlug) return { result: "wrong-event" };
  if (ticket.status !== "valid") return { result: "void" };

  const event = await getEvent(input.eventSlug);
  const ticketTypeName =
    event?.ticketTypes.find((type) => type.id === ticket.ticket_type_id)?.name ?? "Ticket";
  const allowance = checkpointAllowanceFor(checkpoint, ticket.ticket_type_id);

  const view = (used: number): CheckpointTicketView => ({
    ticketId: ticket.access_reference ?? ticket.id,
    holderName: ticket.holder_name,
    ticketTypeName,
    allowance,
    used,
  });

  if (allowance === 0) return { result: "not-included", ticket: view(0) };

  if (consume === 0) {
    const existing = await queryOne<{ used: number }>(
      `select used from checkpoint_usage
        where event_slug = $1 and checkpoint_id = $2 and ticket_id = $3`,
      [input.eventSlug, input.checkpointId, ticket.id],
    );
    return { result: "consumed", ticket: view(existing?.used ?? 0), consumed: 0 };
  }

  // The upsert's guard only covers the update path; a first-ever scan takes
  // the insert path, so an ask beyond the whole allowance is refused here.
  if (consume > allowance) {
    const existing = await queryOne<{ used: number }>(
      `select used from checkpoint_usage
        where event_slug = $1 and checkpoint_id = $2 and ticket_id = $3`,
      [input.eventSlug, input.checkpointId, ticket.id],
    );
    return { result: "over-remaining", ticket: view(existing?.used ?? 0), requested: consume };
  }

  return transaction(async (client) => {
    /**
     * What the rest of the order still has here. A bundle's tickets usually
     * live on one phone, so a spent QR must point at the sibling that isn't.
     * Keep this read on the transaction client: concurrent scans can already
     * occupy every pool connection while they wait for the guarded upsert.
     */
    const groupView = async (): Promise<CheckpointGroupView | undefined> => {
      const { rows: siblings } = await client.query<{ ticket_type_id: string; used: number }>(
        `select t.ticket_type_id, coalesce(u.used, 0) as used
           from tickets t
           left join checkpoint_usage u
             on u.ticket_id = t.id and u.event_slug = $1 and u.checkpoint_id = $2
          where t.order_id = $3 and t.status = 'valid' and t.id <> $4`,
        [input.eventSlug, input.checkpointId, ticket.order_id, ticket.id],
      );
      if (siblings.length === 0) return undefined;
      const othersLeft = siblings.reduce(
        (total, sibling) =>
          total +
          Math.max(0, checkpointAllowanceFor(checkpoint, sibling.ticket_type_id) - sibling.used),
        0,
      );
      return { otherTickets: siblings.length, othersLeft };
    };

    const { rows } = await client.query<{ used: number }>(
      `insert into checkpoint_usage (event_slug, checkpoint_id, ticket_id, used, last_used_by)
       values ($1, $2, $3, $4, $5)
       on conflict (event_slug, checkpoint_id, ticket_id) do update
         set used = checkpoint_usage.used + $4,
             updated_at = now(),
             last_used_by = $5
       where checkpoint_usage.used + $4 <= $6
       returning used`,
      [input.eventSlug, input.checkpointId, ticket.id, consume, input.scannedBy ?? null, allowance],
    );

    if (rows[0]) {
      log.info("checkpoints.scan", "Allowance consumed", {
        slug: input.eventSlug,
        checkpointId: input.checkpointId,
        ticketId,
        consumed: consume,
        used: rows[0].used,
      });
      return {
        result: "consumed" as const,
        ticket: view(rows[0].used),
        consumed: consume,
        group: await groupView(),
      };
    }

    // The guard refused: either fully used, or asking for more than remains.
    const existing = await client.query<{ used: number; updated_at: Date }>(
      `select used, updated_at from checkpoint_usage
        where event_slug = $1 and checkpoint_id = $2 and ticket_id = $3`,
      [input.eventSlug, input.checkpointId, ticket.id],
    );
    const used = existing.rows[0]?.used ?? 0;
    if (used >= allowance) {
      return {
        result: "exhausted" as const,
        ticket: view(used),
        lastUsedAt: existing.rows[0]?.updated_at.toISOString(),
        group: await groupView(),
      };
    }
    return { result: "over-remaining" as const, ticket: view(used), requested: consume };
  });
}

/** Staff correction: wound back one unit at a time, never below zero. */
export async function undoCheckpointUse(input: {
  eventSlug: string;
  checkpointId: string;
  ticketId: string;
  units?: number;
}): Promise<TicketOpResult<{ used: number }>> {
  if (
    !isValidEventSlug(input.eventSlug) ||
    !isValidCheckpointId(input.checkpointId) ||
    !isValidTicketId(input.ticketId)
  ) {
    return { ok: false, status: 400, error: "Unknown ticket or checkpoint" };
  }
  const units = Math.round(input.units ?? 1);
  if (!Number.isFinite(units) || units < 1 || units > 100) {
    return { ok: false, status: 400, error: "Choose how many to put back" };
  }

  const row = await queryOne<{ used: number }>(
    `update checkpoint_usage usage
        set used = greatest(0, usage.used - $4), updated_at = now()
       from tickets ticket
      where usage.event_slug = $1 and usage.checkpoint_id = $2
        and usage.ticket_id = ticket.id
        and ticket.event_slug = $1
        and (ticket.access_reference = $3 or (ticket.access_reference is null and ticket.id = $3))
      returning usage.used`,
    [input.eventSlug, input.checkpointId, input.ticketId, units],
  );
  return { ok: true, value: { used: row?.used ?? 0 } };
}

/** Units already used per ticket at one checkpoint, keyed by ticket id. */
export async function listCheckpointUsage(
  eventSlug: string,
  checkpointId: string,
): Promise<Record<string, number>> {
  if (!isValidEventSlug(eventSlug) || !isValidCheckpointId(checkpointId)) return {};
  const rows = await query<{ ticket_id: string; used: number }>(
    `select ticket_id, used from checkpoint_usage
      where event_slug = $1 and checkpoint_id = $2 and used > 0`,
    [eventSlug, checkpointId],
  );
  const usage: Record<string, number> = {};
  for (const row of rows) usage[row.ticket_id] = row.used;
  return usage;
}

export type CheckpointSummary = {
  checkpointId: string;
  /** Units handed out so far. */
  unitsUsed: number;
  /** Distinct tickets that have consumed at least one unit. */
  ticketsServed: number;
};

export async function getCheckpointSummaries(eventSlug: string): Promise<CheckpointSummary[]> {
  if (!isValidEventSlug(eventSlug)) return [];
  const rows = await query<{ checkpoint_id: string; units: string; tickets: string }>(
    `select checkpoint_id,
            coalesce(sum(used), 0)::text as units,
            count(*) filter (where used > 0)::text as tickets
       from checkpoint_usage
      where event_slug = $1
      group by checkpoint_id`,
    [eventSlug],
  );
  return rows.map((row) => ({
    checkpointId: row.checkpoint_id,
    unitsUsed: Number.parseInt(row.units, 10) || 0,
    ticketsServed: Number.parseInt(row.tickets, 10) || 0,
  }));
}
