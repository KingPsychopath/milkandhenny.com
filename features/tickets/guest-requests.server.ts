import { log } from "@/lib/platform/logger.server";
import { query, queryOne } from "@/lib/platform/postgres.server";
import { isValidEventSlug } from "@/features/events/types";
import type { GuestRequestRecord } from "./checkpoint-types";
import { issueTickets, type TicketOpResult } from "./tickets.server";

/**
 * Guest requests.
 *
 * A scanner at the door can't add someone to the list — but they can ask.
 * The request sits pending until the organiser (or a manager link) decides.
 * Approval comps a ticket on the spot; the requester sees the outcome the
 * next time their page refreshes.
 */

type GuestRequestRow = {
  id: string | number;
  event_slug: string;
  token: string | null;
  requested_by: string;
  name: string;
  note: string | null;
  status: string;
  ticket_id: string | null;
  created_at: Date;
  decided_at: Date | null;
  decided_by: string | null;
};

function toRequest(row: GuestRequestRow): GuestRequestRecord {
  return {
    id: Number(row.id),
    eventSlug: row.event_slug,
    requestedBy: row.requested_by,
    name: row.name,
    note: row.note ?? undefined,
    status: row.status as GuestRequestRecord["status"],
    ticketId: row.ticket_id ?? undefined,
    createdAt: row.created_at.toISOString(),
    decidedAt: row.decided_at?.toISOString(),
    decidedBy: row.decided_by ?? undefined,
  };
}

const MAX_PENDING_PER_LINK = 10;

export async function createGuestRequest(input: {
  eventSlug: string;
  token: string | null;
  requestedBy: string;
  name: string;
  note?: string;
}): Promise<TicketOpResult<GuestRequestRecord>> {
  const name = input.name?.trim();
  if (!name) return { ok: false, status: 400, error: "Who should be added?" };
  if (name.length > 120) return { ok: false, status: 400, error: "That name is too long" };
  if (!isValidEventSlug(input.eventSlug)) {
    return { ok: false, status: 404, error: "Event not found" };
  }

  if (input.token) {
    const pending = await queryOne<{ count: string }>(
      `select count(*)::text as count from guest_requests
        where token = $1 and status = 'pending'`,
      [input.token],
    );
    if (Number.parseInt(pending?.count ?? "0", 10) >= MAX_PENDING_PER_LINK) {
      return {
        ok: false,
        status: 429,
        error: "Too many pending requests — wait for a decision on those first.",
      };
    }
  }

  const row = await queryOne<GuestRequestRow>(
    `insert into guest_requests (event_slug, token, requested_by, name, note)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [input.eventSlug, input.token, input.requestedBy, name, input.note?.trim() || null],
  );
  if (!row) return { ok: false, status: 500, error: "Failed to save the request" };

  log.info("guest-requests.create", "Guest request raised", {
    slug: input.eventSlug,
    requestedBy: input.requestedBy,
  });
  return { ok: true, value: toRequest(row) };
}

/** All of an event's requests (admin, manager), newest first. */
export async function listGuestRequests(
  eventSlug: string,
  status?: GuestRequestRecord["status"],
): Promise<GuestRequestRecord[]> {
  if (!isValidEventSlug(eventSlug)) return [];
  const rows = status
    ? await query<GuestRequestRow>(
        `select * from guest_requests where event_slug = $1 and status = $2
          order by created_at desc limit 100`,
        [eventSlug, status],
      )
    : await query<GuestRequestRow>(
        `select * from guest_requests where event_slug = $1
          order by created_at desc limit 100`,
        [eventSlug],
      );
  return rows.map(toRequest);
}

/** One link's own requests, newest first — what the scanner's badge shows. */
export async function listGuestRequestsForToken(token: string): Promise<GuestRequestRecord[]> {
  if (!token) return [];
  const rows = await query<GuestRequestRow>(
    `select * from guest_requests where token = $1 order by created_at desc limit 20`,
    [token],
  );
  return rows.map(toRequest);
}

/** A scanner may withdraw their own request while it is still pending. */
export async function cancelGuestRequest(id: number, token: string): Promise<TicketOpResult<void>> {
  if (!Number.isInteger(id) || !token) {
    return { ok: false, status: 400, error: "Unknown request" };
  }
  const row = await queryOne<GuestRequestRow>(
    `update guest_requests
        set status = 'cancelled', decided_at = now(), decided_by = 'requester'
      where id = $1 and token = $2 and status = 'pending'
      returning *`,
    [id, token],
  );
  if (!row) return { ok: false, status: 409, error: "Already decided" };
  return { ok: true, value: undefined };
}

/**
 * Decide a pending request. Approval comps a ticket immediately.
 *
 * The `where status = 'pending'` predicate makes simultaneous deciders safe:
 * the second one sees zero rows and reports "already decided" instead of
 * double-issuing.
 */
export async function decideGuestRequest(input: {
  eventSlug: string;
  id: number;
  approve: boolean;
  decidedBy: string;
  ticketTypeId?: string;
}): Promise<TicketOpResult<GuestRequestRecord>> {
  if (!Number.isInteger(input.id)) return { ok: false, status: 400, error: "Unknown request" };

  const claimed = await queryOne<GuestRequestRow>(
    `update guest_requests
        set status = $3, decided_at = now(), decided_by = $4
      where id = $1 and event_slug = $2 and status = 'pending'
      returning *`,
    [input.id, input.eventSlug, input.approve ? "approved" : "declined", input.decidedBy],
  );
  if (!claimed) return { ok: false, status: 409, error: "Already decided" };
  if (!input.approve) return { ok: true, value: toRequest(claimed) };

  const { getEvent } = await import("@/features/events/store.server");
  const event = await getEvent(input.eventSlug);
  const ticketTypeId =
    input.ticketTypeId ??
    event?.ticketTypes.find((type) => !type.hidden)?.id ??
    event?.ticketTypes[0]?.id;
  if (!event || !ticketTypeId) {
    // Roll the decision back rather than approve without a ticket.
    await query(
      `update guest_requests set status = 'pending', decided_at = null, decided_by = null
        where id = $1`,
      [input.id],
    );
    return { ok: false, status: 409, error: "No ticket type to issue against" };
  }

  const issued = await issueTickets({
    eventSlug: input.eventSlug,
    ticketTypeId,
    holderName: claimed.name,
    quantity: 1,
    kind: "comp",
    notes: `guest request by ${claimed.requested_by}`,
    force: true,
  });
  if (!issued.ok) {
    await query(
      `update guest_requests set status = 'pending', decided_at = null, decided_by = null
        where id = $1`,
      [input.id],
    );
    return { ok: false, status: issued.status, error: issued.error };
  }

  const ticketId = issued.value.tickets[0]?.id ?? null;
  const updated = await queryOne<GuestRequestRow>(
    `update guest_requests set ticket_id = $2 where id = $1 returning *`,
    [input.id, ticketId],
  );

  log.info("guest-requests.decide", "Guest request approved", {
    slug: input.eventSlug,
    id: input.id,
    decidedBy: input.decidedBy,
  });
  return { ok: true, value: toRequest(updated ?? claimed) };
}

/** Pending count per event, for the admin badge. */
export async function countPendingGuestRequests(eventSlug: string): Promise<number> {
  if (!isValidEventSlug(eventSlug)) return 0;
  const row = await queryOne<{ count: string }>(
    `select count(*)::text as count from guest_requests
      where event_slug = $1 and status = 'pending'`,
    [eventSlug],
  );
  return Number.parseInt(row?.count ?? "0", 10);
}
