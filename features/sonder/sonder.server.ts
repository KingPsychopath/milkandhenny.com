import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getEvent } from "@/features/events/store.server";
import { eventsOperation } from "@/features/events/events-operation.server";
import { transaction, query } from "@/lib/platform/postgres.server";
import {
  fetchSonderOrders,
  SonderReadError,
  sonderConfiguration,
} from "@/lib/platform/sonder.server";
import { enqueueEmailInTransaction, wakeEmailOutbox } from "@/lib/platform/email-outbox.server";
import { renderEventMessage } from "@/features/tickets/email.server";
import { isTeamCount, teamPaletteForCount } from "@/lib/shared/team-palette";
import {
  chooseBookingTeam,
  isUuid,
  validSonderBookingUrl,
  activeSonderTicket,
  type SonderOrder,
  type SonderEvent,
  type SonderMapping,
} from "./types";

const FRESH_MS = 10 * 60_000;
type Link = {
  event_slug: string;
  hangout_id: string;
  mode: "live" | "test";
  booking_url: string;
  cancelled_at: Date | null;
  last_sync_at: Date | null;
  last_webhook_at: Date | null;
  dirty_revision: string;
  synced_revision: string;
  last_error: string | null;
  paused: boolean;
};
type StoredOrder = {
  id: string;
  snapshot: SonderOrder;
  team_id: string | null;
  revision: string;
  missing: boolean;
  conflict: boolean;
};
function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function fresh(link: Link) {
  return (
    !!link.last_sync_at &&
    Date.now() - link.last_sync_at.getTime() < FRESH_MS &&
    !link.last_error &&
    !link.paused &&
    link.dirty_revision === link.synced_revision
  );
}
export function sonderOperation<A>(name: string, run: (signal: AbortSignal) => Promise<A>) {
  return eventsOperation(
    {
      domain: "events",
      operation: `sonder_${name}`,
      kind: "idempotent-mutation",
      timeoutMs: 90_000,
    },
    run,
  );
}
export async function configureSonderEvent(slug: string, input: SonderMapping) {
  if (
    !isUuid(input.hangoutId) ||
    (input.mode !== "live" && input.mode !== "test") ||
    !validSonderBookingUrl(input.bookingUrl)
  )
    throw new Error("Enter a Sonder hangout UUID, mode and HTTPS booking URL");
  if (input.mode !== sonderConfiguration().mode)
    throw new Error("Choose the mode configured for this deployment before mapping the occurrence");
  await transaction(async (client) => {
    const event = await client.query(`select slug from events where slug=$1 for update`, [slug]);
    if (!event.rowCount) throw new Error("Event not found");
    const existing = await client.query<Link>(
      `select * from sonder_event_links where event_slug=$1`,
      [slug],
    );
    if (
      existing.rows[0] &&
      (existing.rows[0].hangout_id !== input.hangoutId.toLowerCase() ||
        existing.rows[0].mode !== input.mode)
    )
      throw new Error("A mapped occurrence cannot change its Sonder hangout or mode");
    await client.query(
      `insert into sonder_event_links(event_slug,hangout_id,mode,booking_url) values($1,$2,$3,$4)
      on conflict(event_slug) do update set booking_url=excluded.booking_url`,
      [slug, input.hangoutId, input.mode, input.bookingUrl],
    );
  });
}
/** Persist only routing metadata, never the raw buyer data or QR credentials. */
export async function receiveSonderEvent(event: SonderEvent): Promise<{ duplicate: boolean }> {
  return transaction(async (client) => {
    const saved = await client.query(
      `insert into sonder_webhook_events(mode,id,type,occurred_at) values($1,$2,$3,$4) on conflict do nothing returning id`,
      [event.mode, event.id, event.type, event.occurred_at],
    );
    if (!saved.rowCount) return { duplicate: true };
    if (event.hangoutId) {
      const links = await client.query<{ event_slug: string }>(
        `select link.event_slug from sonder_event_links link join events event on event.slug=link.event_slug where coalesce(event.ends_at,event.starts_at)>=now()-interval '30 days' and mode=$1 and hangout_id=$2`,
        [event.mode, event.hangoutId],
      );
      if (!links.rows[0]) return { duplicate: false };
      await client.query(`select slug from events where slug=$1 for update`, [
        links.rows[0].event_slug,
      ]);
      const updated = await client.query<{ event_slug: string }>(
        `update sonder_event_links set dirty_revision=dirty_revision+1,last_webhook_at=now(),next_sync_at=least(next_sync_at,now()),cancelled_at=coalesce(cancelled_at,$3::timestamptz)
        where mode=$1 and hangout_id=$2 returning event_slug`,
        [event.mode, event.hangoutId, event.cancelledAt],
      );
      if (event.cancelledAt && updated.rows[0]) {
        await client.query(
          `update event_participants set status='void',updated_at=now() where id in(select participant_id from sonder_tickets where event_slug=$1)`,
          [updated.rows[0].event_slug],
        );
        await closeVoidedSonderMemberships(client, updated.rows[0].event_slug);
      }
    }
    return { duplicate: false };
  });
}
async function closeVoidedSonderMemberships(client: PoolClient, slug: string) {
  await client.query(
    `update score_team_memberships set ends_at=now() where ends_at is null and participant_id in(select t.participant_id from sonder_tickets t join event_participants p on p.id=t.participant_id where t.event_slug=$1 and p.status<>'active')`,
    [slug],
  );
}
async function assignOrder(
  client: PoolClient,
  slug: string,
  orderId: string,
  teamId: string,
  actorId: string | null,
) {
  const team = await client.query(
    `select id from score_teams where id=$1 and event_slug=$2 and status='active' and colour_key is not null`,
    [teamId, slug],
  );
  if (!team.rowCount) {
    if (actorId) throw new Error("Choose an active coloured team for this event");
    await client.query(
      `update sonder_orders set team_id=null,revision=revision+1 where event_slug=$1 and id=$2`,
      [slug, orderId],
    );
    await client.query(
      `update score_team_memberships set ends_at=now() where event_slug=$1 and ends_at is null and participant_id in(select participant_id from sonder_tickets where event_slug=$1 and order_id=$2)`,
      [slug, orderId],
    );
    return;
  }
  await client.query(
    `update sonder_orders set revision=revision+case when team_id is distinct from $3 then 1 else 0 end,team_id=$3 where event_slug=$1 and id=$2`,
    [slug, orderId, teamId],
  );
  const at = new Date();
  await client.query(
    `update score_team_memberships set ends_at=$3 where event_slug=$1 and ends_at is null and participant_id in(select participant_id from sonder_tickets where event_slug=$1 and order_id=$2) and team_id<>$4`,
    [slug, orderId, at, teamId],
  );
  await client.query(
    `insert into score_team_memberships(id,event_slug,team_id,participant_id,starts_at)
    select 'tm_'||md5(random()::text||ticket.id::text),$1,$3,ticket.participant_id,$4 from sonder_tickets ticket join event_participants participant on participant.id=ticket.participant_id and participant.status='active'
    where ticket.event_slug=$1 and ticket.order_id=$2 and ticket.status in ('valid','checked_in') and not exists(select 1 from score_team_memberships membership where membership.participant_id=ticket.participant_id and membership.ends_at is null and membership.team_id=$3)`,
    [slug, orderId, teamId, at],
  );
  if (actorId)
    await client.query(
      `insert into score_audit_events(event_slug,action,actor_type,actor_id,entity_type,entity_id,metadata) values($1,'sonder.booking.assigned','admin',$2,'order',$3,'{}')`,
      [slug, actorId, orderId],
    );
}
export async function assignSonderBooking(
  slug: string,
  orderId: string,
  teamId: string,
  actorId: string,
) {
  if (!isUuid(orderId)) throw new Error("Invalid order UUID");
  await transaction(async (client) => {
    await client.query(`select slug from events where slug=$1 for update`, [slug]);
    const links = await client.query<Link>(
      `select * from sonder_event_links where event_slug=$1 for update`,
      [slug],
    );
    if (!links.rows[0] || !fresh(links.rows[0]) || links.rows[0].cancelled_at)
      throw new Error("Sync current, uncancelled orders before assigning a booking");
    const order = await client.query(
      `select id from sonder_orders where event_slug=$1 and id=$2 and not missing and not conflict and not (snapshot->>'review_required')::boolean and snapshot->>'status'<>'needs_review' for update`,
      [slug, orderId],
    );
    if (!order.rowCount) throw new Error("Order not found");
    await assignOrder(client, slug, orderId, teamId, actorId);
  });
}
async function applySnapshot(
  client: PoolClient,
  link: Link,
  orders: SonderOrder[],
  token: string,
  cancelledAt: string | null,
  revision: string,
) {
  const slug = link.event_slug;
  await client.query(`select slug from events where slug=$1 for update`, [slug]);
  const ownership = await client.query<Link>(
    `select * from sonder_event_links where event_slug=$1 and sync_token=$2 and sync_until>now() for update`,
    [slug, token],
  );
  if (!ownership.rowCount) throw new Error("Sonder sync lost its lease");
  const cancelled = !!(ownership.rows[0]!.cancelled_at || cancelledAt);
  const seenTickets = new Map<string, string>(),
    conflictingOrders = new Set<string>();
  for (const order of orders)
    for (const ticket of order.tickets) {
      const prior = seenTickets.get(ticket.id);
      if (prior && prior !== order.order_id) {
        conflictingOrders.add(prior);
        conflictingOrders.add(order.order_id);
      }
      seenTickets.set(ticket.id, order.order_id);
    }
  for (const order of orders) {
    const previous = await client.query<StoredOrder>(
      `select * from sonder_orders where event_slug=$1 and id=$2 for update`,
      [slug, order.order_id],
    );
    const old = previous.rows[0];
    const conflict =
      conflictingOrders.has(order.order_id) ||
      order.tickets.some((ticket) => {
        const prior = old?.snapshot.tickets.find((t) => t.id === ticket.id);
        return (
          ticket.status === "valid" &&
          (prior?.status === "inactive" || prior?.status === "checked_in")
        );
      });
    await client.query(
      `insert into sonder_orders(event_slug,id,snapshot,snapshot_hash,seen_in_sync,conflict) values($1,$2,$3::jsonb,$4,$5,$6)
      on conflict(event_slug,id) do update set snapshot=excluded.snapshot,revision=sonder_orders.revision+case when sonder_orders.snapshot_hash<>excluded.snapshot_hash then 1 else 0 end,snapshot_hash=excluded.snapshot_hash,seen_in_sync=excluded.seen_in_sync,missing=false,conflict=sonder_orders.conflict or excluded.conflict`,
      [slug, order.order_id, JSON.stringify(order), hash(order), token, conflict],
    );
    for (const ticket of order.tickets) {
      const participantId = `ep_sonder_${hash([link.mode, link.hangout_id, ticket.id]).slice(0, 28)}`;
      const priorTicket = await client.query<{ order_id: string }>(
        `select order_id from sonder_tickets where event_slug=$1 and id=$2`,
        [slug, ticket.id],
      );
      if (priorTicket.rows[0] && priorTicket.rows[0].order_id !== order.order_id) {
        await client.query(
          `update sonder_orders set conflict=true,revision=revision+1 where event_slug=$1 and id=any($2::uuid[])`,
          [slug, [priorTicket.rows[0].order_id, order.order_id]],
        );
        await client.query(
          `update score_team_memberships set ends_at=now() where participant_id=$1 and ends_at is null`,
          [participantId],
        );
      }
      const active = activeSonderTicket(order, ticket, cancelled || conflict || !!old?.conflict);
      await client.query(
        `insert into event_participants(id,event_slug,generated_alias,status,checked_in_at)
        values($1,$2,$3,$4,$5) on conflict(id) do update set status=excluded.status,checked_in_at=excluded.checked_in_at,updated_at=now()`,
        [
          participantId,
          slug,
          `guest-${hash(ticket.id).slice(0, 16)}`,
          active ? "active" : "void",
          ticket.checked_in_at,
        ],
      );
      await client.query(
        `insert into sonder_tickets(event_slug,id,order_id,ordinal,status,checked_in_at,participant_id) values($1,$2,$3,$4,$5,$6,$7)
        on conflict(event_slug,id) do update set order_id=excluded.order_id,ordinal=excluded.ordinal,status=excluded.status,checked_in_at=excluded.checked_in_at`,
        [
          slug,
          ticket.id,
          order.order_id,
          ticket.ordinal,
          ticket.status,
          ticket.checked_in_at,
          participantId,
        ],
      );
    }
    // Preserve historical issued rows, but omissions must never retain an active entitlement.
    await client.query(
      `update sonder_tickets set status='inactive' where event_slug=$1 and order_id=$2 and not(id=any($3::uuid[]))`,
      [slug, order.order_id, order.tickets.map((t) => t.id)],
    );
    await client.query(
      `update event_participants set status='void',updated_at=now() where id in(select participant_id from sonder_tickets where event_slug=$1 and order_id=$2 and status='inactive')`,
      [slug, order.order_id],
    );
    await client.query(
      `update score_team_memberships set ends_at=now() where ends_at is null and participant_id in(select participant_id from sonder_tickets where event_slug=$1 and order_id=$2 and status='inactive')`,
      [slug, order.order_id],
    );
    if (old?.team_id) await assignOrder(client, slug, order.order_id, old.team_id, null);
  }
  // A moving API scan cannot establish deletion. Keep omissions for review and
  // exclude them from recipient selection rather than destroying their history.
  await client.query(
    `update sonder_orders set missing=true,revision=revision+case when missing then 0 else 1 end where event_slug=$1 and seen_in_sync<>$2`,
    [slug, token],
  );
  await client.query(
    `update sonder_event_links set cancelled_at=coalesce(cancelled_at,$3::timestamptz),last_sync_at=now(),synced_revision=$4,last_error=null,paused=false,next_sync_at=case when dirty_revision=$4 then now()+interval '5 minutes' else now() end,sync_token=null,sync_until=null where event_slug=$1 and sync_token=$2`,
    [slug, token, cancelledAt, revision],
  );
  await client.query(
    `update event_participants set status='void',updated_at=now() where id in(select t.participant_id from sonder_tickets t join sonder_orders o on o.event_slug=t.event_slug and o.id=t.order_id where t.event_slug=$1 and (o.missing or o.conflict))`,
    [slug],
  );
  if (cancelled)
    await client.query(
      `update event_participants set status='void',updated_at=now() where id in(select participant_id from sonder_tickets where event_slug=$1)`,
      [slug],
    );
  await closeVoidedSonderMemberships(client, slug);
}
export async function syncSonderEvent(slug: string, signal: AbortSignal) {
  const config = sonderConfiguration();
  if (!config.apiKey || !config.mode)
    throw new Error("Sonder read key and mode are not configured");
  const event = await getEvent(slug);
  if (!event || Date.now() > Date.parse(event.endsAt ?? event.startsAt) + 30 * 86400_000)
    throw new Error("Sonder contact retention window has ended");
  const token = randomUUID();
  const claimed = await query<Link>(
    `update sonder_event_links set sync_token=$2,sync_until=now()+interval '2 minutes' where event_slug=$1 and mode=$3 and (sync_until is null or sync_until<now()) returning *`,
    [slug, token, config.mode],
  );
  const link = claimed[0];
  if (!link) throw new Error("Sonder mapping is missing, uses another mode, or is already syncing");
  try {
    const snapshot = await fetchSonderOrders({
      hangoutId: link.hangout_id,
      mode: link.mode,
      apiKey: config.apiKey,
      signal: AbortSignal.any([signal, AbortSignal.timeout(80_000)]),
    });
    await transaction((client) =>
      applySnapshot(
        client,
        link,
        snapshot.orders,
        token,
        snapshot.cancelledAt,
        link.dirty_revision,
      ),
    );
    return { orders: snapshot.orders.length };
  } catch (error) {
    const reason =
      error instanceof SonderReadError
        ? error.message
        : "Sonder sync failed; previous figures retained";
    const retry = error instanceof SonderReadError ? error.retryAfterSeconds : 300;
    await query(
      `update sonder_event_links set last_error=$3,paused=$4,next_sync_at=now()+make_interval(secs=>$5),sync_token=null,sync_until=null where event_slug=$1 and sync_token=$2`,
      [slug, token, reason, error instanceof SonderReadError && error.status === 401, retry],
    );
    // Provider/database causes may contain private contact data; expose only the classified reason.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(reason);
  }
}
export async function syncDueSonderEvents(signal: AbortSignal) {
  await query(
    `update sonder_orders o set snapshot=jsonb_set(o.snapshot,'{purchaser}','{"name":null,"email":""}'::jsonb),revision=revision+1 from events e where e.slug=o.event_slug and coalesce(e.ends_at,e.starts_at)<now()-interval '30 days' and o.snapshot->'purchaser'->>'email'<>''`,
  );
  await query(
    `update sonder_event_links link set paused=true,last_error='Contact retention window ended' from events e where e.slug=link.event_slug and not link.paused and coalesce(e.ends_at,e.starts_at)<now()-interval '30 days'`,
  );
  await query(
    `update email_outbox outbox set status='cancelled',cancelled_at=now(),message=null,locked_until=null,last_error='Sonder contact retention window ended' from sonder_email_guards guard join events e on e.slug=guard.event_slug where outbox.id=guard.outbox_id and outbox.status in ('pending','processing') and coalesce(e.ends_at,e.starts_at)<now()-interval '30 days'`,
  );
  await query(`delete from sonder_webhook_events where received_at<now()-interval '30 days'`);
  const config = sonderConfiguration();
  if (!config.mode || !config.apiKey) return 0;
  const due = await query<{ event_slug: string }>(
    `select link.event_slug from sonder_event_links link join events event on event.slug=link.event_slug where coalesce(event.ends_at,event.starts_at)>=now()-interval '30 days' and mode=$1 and not paused and next_sync_at<=now() order by next_sync_at limit 1`,
    [config.mode],
  );
  let synced = 0;
  for (const row of due) {
    if (signal.aborted) break;
    try {
      await syncSonderEvent(row.event_slug, signal);
      synced++;
    } catch {
      /* Failure state is durable and visible to the operator. */
    }
  }
  return synced;
}
async function storedOrders(
  client: Pick<PoolClient, "query">,
  slug: string,
): Promise<StoredOrder[]> {
  const orders = await client.query<StoredOrder>(
    `select * from sonder_orders where event_slug=$1 order by id`,
    [slug],
  );
  const tickets = await client.query<{
    order_id: string;
    id: string;
    ordinal: number;
    status: "valid" | "checked_in" | "inactive";
    checked_in_at: Date | null;
  }>(
    `select order_id,id,ordinal,status,checked_in_at from sonder_tickets where event_slug=$1 order by ordinal,id`,
    [slug],
  );
  return orders.rows.map((order) => ({
    ...order,
    snapshot: {
      ...order.snapshot,
      tickets: tickets.rows
        .filter((t) => t.order_id === order.id)
        .map((t) => ({
          id: t.id,
          ordinal: t.ordinal,
          status: t.status,
          checked_in_at: t.checked_in_at?.toISOString() ?? null,
        })),
    },
  }));
}
export async function allocateSonderBookings(slug: string, actorId: string) {
  return transaction(async (client) => {
    await client.query(`select slug from events where slug=$1 for update`, [slug]);
    const links = await client.query<Link>(
      `select * from sonder_event_links where event_slug=$1 for update`,
      [slug],
    );
    const link = links.rows[0];
    if (!link || !fresh(link) || link.cancelled_at)
      throw new Error("Sync current orders before allocating teams");
    const teams = await client.query<{ id: string }>(
      `select id from score_teams where event_slug=$1 and status='active' and colour_key is not null order by sort_order,id`,
      [slug],
    );
    if (!teams.rowCount) throw new Error("Create coloured teams first");
    const sizes = new Map(teams.rows.map((t) => [t.id, 0]));
    const orders = await storedOrders(client, slug);
    const eligible = orders.filter(
      (o) =>
        !o.missing &&
        !o.conflict &&
        o.snapshot.tickets.some((t) => activeSonderTicket(o.snapshot, t)),
    );
    for (const order of eligible)
      if (order.team_id && sizes.has(order.team_id))
        sizes.set(
          order.team_id,
          sizes.get(order.team_id)! +
            order.snapshot.tickets.filter((t) => activeSonderTicket(order.snapshot, t)).length,
        );
    let assigned = 0;
    for (const order of eligible.filter((o) => !o.team_id)) {
      const team = chooseBookingTeam([...sizes].map(([id, size]) => ({ id, size })))!;
      await assignOrder(client, slug, order.id, team, actorId);
      sizes.set(
        team,
        sizes.get(team)! +
          order.snapshot.tickets.filter((t) => activeSonderTicket(order.snapshot, t)).length,
      );
      assigned++;
    }
    return { assigned };
  });
}
export async function prepareSonderTeams(slug: string, count: unknown) {
  if (!isTeamCount(count)) throw new Error("Choose two, three or four teams");
  await transaction(async (client) => {
    await client.query(`select slug from events where slug=$1 for update`, [slug]);
    const link = await client.query(
      `select event_slug from sonder_event_links where event_slug=$1`,
      [slug],
    );
    if (!link.rowCount) throw new Error("Map this occurrence to Sonder first");
    const assigned = await client.query(
      `select id from sonder_orders where event_slug=$1 and team_id is not null limit 1`,
      [slug],
    );
    const existing = await client.query<{ id: string; colour_key: string | null }>(
      `select id,colour_key from score_teams where event_slug=$1 and status='active' order by sort_order,id for update`,
      [slug],
    );
    if (assigned.rowCount) {
      if (existing.rowCount !== count || existing.rows.some((t) => !t.colour_key))
        throw new Error("Keep the existing teams once bookings are allocated");
      return;
    }
    const palette = teamPaletteForCount(count);
    for (const [index, entry] of palette.entries()) {
      const prior = existing.rows[index];
      if (prior)
        await client.query(`update score_teams set colour_key=$2,sort_order=$3 where id=$1`, [
          prior.id,
          entry.colourKey,
          index,
        ]);
      else
        await client.query(
          `insert into score_teams(id,event_slug,name,colour_key,sort_order) values($1,$2,$3,$4,$5)`,
          [`team_${randomUUID()}`, slug, entry.defaultName, entry.colourKey, index],
        );
    }
    for (const team of existing.rows.slice(count))
      await client.query(`update score_teams set status='archived' where id=$1`, [team.id]);
  });
}
export async function acknowledgeSonderOrder(
  slug: string,
  orderId: string,
  revision: string,
  actorId: string,
) {
  if (!isUuid(orderId) || !/^\d+$/.test(revision)) throw new Error("Invalid booking review");
  await transaction(async (client) => {
    await client.query(`select slug from events where slug=$1 for update`, [slug]);
    const links = await client.query<Link>(
      `select * from sonder_event_links where event_slug=$1 for update`,
      [slug],
    );
    if (!links.rows[0] || !fresh(links.rows[0]) || links.rows[0].cancelled_at)
      throw new Error("Sync the current Sonder state before reviewing");
    const orders = await storedOrders(client, slug),
      order = orders.find((o) => o.id === orderId);
    if (
      !order ||
      order.revision !== revision ||
      order.missing ||
      order.snapshot.review_required ||
      order.snapshot.status === "needs_review"
    )
      throw new Error("This booking needs a current, resolved Sonder snapshot");
    const snapshots = await client.query<{ duplicate: boolean }>(
      `select exists(select 1 from sonder_orders o, jsonb_array_elements(o.snapshot->'tickets') t where o.event_slug=$1 and not o.missing and t->>'id'=any($2::text[]) group by t->>'id' having count(*)>1) as duplicate`,
      [slug, order.snapshot.tickets.map((t) => t.id)],
    );
    if (snapshots.rows[0]?.duplicate)
      throw new Error("Sonder still reports conflicting ticket ownership; sync again");
    await client.query(
      `update sonder_orders set conflict=false,revision=revision+1 where event_slug=$1 and id=$2`,
      [slug, orderId],
    );
    for (const ticket of order.snapshot.tickets)
      await client.query(
        `update event_participants set status=$3,updated_at=now() where id=(select participant_id from sonder_tickets where event_slug=$1 and id=$2)`,
        [slug, ticket.id, activeSonderTicket(order.snapshot, ticket) ? "active" : "void"],
      );
    if (order.team_id) await assignOrder(client, slug, orderId, order.team_id, actorId);
  });
}
export async function readSonderEvent(slug: string, existingClient?: PoolClient) {
  const load = async (client: PoolClient) => {
    const links = await client.query<Link>(`select * from sonder_event_links where event_slug=$1`, [
      slug,
    ]);
    if (!links.rows[0]) return null;
    const orders = await storedOrders(client, slug);
    const teams = await client.query<{ id: string; name: string; colour_key: string }>(
      `select id,name,colour_key from score_teams where event_slug=$1 and status='active' and colour_key is not null order by sort_order,id`,
      [slug],
    );
    const delivery = await client.query<{ status: string; count: string }>(
      `select outbox.status,count(*)::text from sonder_email_guards guard join email_outbox outbox on outbox.id=guard.outbox_id where guard.event_slug=$1 group by outbox.status`,
      [slug],
    );
    return { link: links.rows[0], orders, teams: teams.rows, delivery: delivery.rows };
  };
  const state = existingClient
    ? await load(existingClient)
    : await transaction(async (client) => {
        await client.query(`set transaction isolation level repeatable read`);
        return load(client);
      });
  if (!state) return null;
  const { link, orders, teams } = state;
  const tickets = orders.flatMap((o) => o.snapshot.tickets.map((t) => ({ order: o, ticket: t })));
  const active = tickets.filter((t) =>
    activeSonderTicket(
      t.order.snapshot,
      t.ticket,
      !!link.cancelled_at || t.order.missing || t.order.conflict,
    ),
  );
  const currencyTotals: Record<string, { grossMinor: number; refundedMinor: number }> = {};
  for (const order of orders) {
    const total = (currencyTotals[order.snapshot.currency] ??= { grossMinor: 0, refundedMinor: 0 });
    total.grossMinor += order.snapshot.amount_total_minor;
    total.refundedMinor += order.snapshot.amount_refunded_minor;
  }
  return {
    mapping: {
      hangoutId: link.hangout_id,
      mode: link.mode,
      bookingUrl: link.booking_url,
      cancelledAt: link.cancelled_at?.toISOString() ?? null,
    },
    fresh: fresh(link),
    lastSyncAt: link.last_sync_at?.toISOString() ?? null,
    lastError: link.last_error,
    paused: link.paused,
    emailsEnabled:
      process.env.SONDER_TEAM_EMAILS_ENABLED === "true" &&
      sonderConfiguration().mode === "live" &&
      link.mode === "live" &&
      !link.paused,
    counts: {
      orders: orders.length,
      issued: tickets.length,
      active: active.length,
      checkedIn: active.filter((t) => t.ticket.status === "checked_in").length,
      inactive: tickets.length - active.length,
      needsReview: orders.filter(
        (o) =>
          o.missing ||
          o.conflict ||
          o.snapshot.review_required ||
          o.snapshot.status === "needs_review",
      ).length,
      unassigned: active.filter((t) => !t.order.team_id).length,
    },
    currencyTotals,
    delivery: state.delivery.map((row) => ({ status: row.status, count: Number(row.count) })),
    teams: teams.map((t) => ({
      ...t,
      size: active.filter((a) => a.order.team_id === t.id).length,
    })),
    orders: orders.map((o) => ({
      id: o.id,
      purchaser: o.snapshot.purchaser,
      ticketType: o.snapshot.ticket_type.name,
      quantity: o.snapshot.quantity,
      active: o.snapshot.tickets.filter((t) =>
        activeSonderTicket(o.snapshot, t, !!link.cancelled_at || o.missing || o.conflict),
      ).length,
      checkedIn: o.snapshot.tickets.filter(
        (t) =>
          activeSonderTicket(o.snapshot, t, !!link.cancelled_at || o.missing || o.conflict) &&
          t.status === "checked_in",
      ).length,
      teamId: o.team_id,
      revision: o.revision,
      needsReview:
        o.missing ||
        o.conflict ||
        o.snapshot.review_required ||
        o.snapshot.status === "needs_review",
      canReview:
        o.conflict &&
        !o.missing &&
        !o.snapshot.review_required &&
        o.snapshot.status !== "needs_review",
    })),
  };
}
export type SonderEventView = NonNullable<Awaited<ReturnType<typeof readSonderEvent>>>;
export async function previewSonderTeamEmails(
  slug: string,
  client?: PoolClient,
  suppliedEvent?: Awaited<ReturnType<typeof getEvent>>,
) {
  const view = await readSonderEvent(slug, client),
    event = suppliedEvent ?? (await getEvent(slug));
  if (!view || !event || !view.fresh || view.mapping.cancelledAt || event.status === "cancelled")
    throw new Error("Sync current, uncancelled orders before preparing emails");
  if (Date.parse(event.endsAt ?? event.startsAt) < Date.now() - 30 * 86400_000)
    throw new Error("Contact retention window ended");
  const recipients = view.orders
    .filter((o) => o.active > 0 && !o.needsReview && o.teamId)
    .map((order) => {
      const team = view.teams.find((t) => t.id === order.teamId);
      if (!team) throw new Error("An assigned team is no longer active");
      const body = `Your booking group is on **${team.name}** — your colour is **${team.colour_key}**.\n\nThis covers ${order.active} ${order.active === 1 ? "guest" : "guests"} in your booking. Please share this with everyone coming with you.\n\nBring the tickets Sonder sent you for entry. This message gives your team details; door scanning is handled by Sonder.`;
      return {
        orderId: order.id,
        revision: order.revision,
        teamId: team.id,
        teamName: team.name,
        teamColour: team.colour_key,
        eventUpdatedAt: event.updatedAt,
        to: order.purchaser.email,
        rendered: renderEventMessage({ event, subject: `Your team — ${event.title}`, body }),
      };
    });
  return {
    revision: hash(
      recipients.map((r) => [
        r.orderId,
        r.revision,
        r.to,
        r.rendered.subject,
        r.rendered.text,
        r.rendered.html,
      ]),
    ),
    recipients,
  };
}
export async function queueSonderTeamEmails(slug: string, previewRevision: string) {
  if (process.env.SONDER_TEAM_EMAILS_ENABLED !== "true" || sonderConfiguration().mode !== "live")
    throw new Error("Sonder team emails are disabled until live setup is verified");

  const link = await readSonderEvent(slug);
  if (link?.mapping.mode !== "live") throw new Error("Test mappings cannot send guest emails");
  const event = await getEvent(slug);
  if (!event) throw new Error("Event not found");
  let queued = 0,
    skipped = 0;
  await transaction(async (client) => {
    const locked = await client.query<{ updated_at: Date }>(
      `select updated_at from events where slug=$1 for update`,
      [slug],
    );
    if (locked.rows[0]?.updated_at.getTime() !== Date.parse(event.updatedAt))
      throw new Error("Event changed; preview again");
    await client.query(`select id from score_teams where event_slug=$1 for share`, [slug]);
    const preview = await previewSonderTeamEmails(slug, client, event);
    if (preview.revision !== previewRevision)
      throw new Error("Bookings or teams changed; preview the emails again");
    const mapping = await client.query<Link>(
      `select * from sonder_event_links where event_slug=$1 for update`,
      [slug],
    );
    if (!mapping.rows[0] || !fresh(mapping.rows[0]) || mapping.rows[0].cancelled_at)
      throw new Error("Sync state changed; preview again");
    for (const recipient of preview.recipients) {
      const current = await client.query<StoredOrder>(
        `select * from sonder_orders where event_slug=$1 and id=$2 for update`,
        [slug, recipient.orderId],
      );
      if (current.rows[0]?.revision !== recipient.revision)
        throw new Error("Bookings changed; preview again");
      const contentHash = hash([
        recipient.to,
        recipient.rendered.subject,
        recipient.rendered.text,
        recipient.rendered.html,
      ]);
      const emailVersion = await client.query<{ email_revision: string }>(
        `update sonder_orders set email_revision=email_revision+case when last_email_hash is distinct from $3 then 1 else 0 end,last_email_hash=$3 where event_slug=$1 and id=$2 returning email_revision`,
        [slug, recipient.orderId, contentHash],
      );
      const email = await enqueueEmailInTransaction(
        client,
        {
          channel: "communications",
          to: recipient.to,
          subject: recipient.rendered.subject,
          text: recipient.rendered.text,
          html: recipient.rendered.html,
        },
        {
          kind: "event-team",
          source: "admin",
          idempotencyKey: `sonder-team:${link.mapping.hangoutId}:${recipient.orderId}:${emailVersion.rows[0]!.email_revision}:${contentHash}`,
          context: { eventSlug: slug, orderId: recipient.orderId },
        },
      );
      if (!email.ok) {
        skipped++;
        continue;
      }
      if (!email.id) throw new Error("Team email could not be queued");
      await client.query(
        `insert into sonder_email_guards(outbox_id,event_slug,order_id,revision,content_hash,team_id,team_name,team_colour,event_updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(outbox_id) do update set revision=excluded.revision,team_id=excluded.team_id,team_name=excluded.team_name,team_colour=excluded.team_colour,event_updated_at=excluded.event_updated_at`,
        [
          email.id,
          slug,
          recipient.orderId,
          recipient.revision,
          hash([
            recipient.to,
            recipient.rendered.subject,
            recipient.rendered.text,
            recipient.rendered.html,
          ]),
          recipient.teamId,
          recipient.teamName,
          recipient.teamColour,
          recipient.eventUpdatedAt,
        ],
      );
      const requeued = await client.query(
        `update email_outbox set status='pending',cancelled_at=null,message=$2::jsonb,attempts=0,next_attempt_at=now(),content_expires_at=now()+interval '7 days',last_error=null where id=$1 and status='cancelled' and provider_message_id is null returning id`,
        [
          email.id,
          JSON.stringify({
            channel: "communications",
            to: recipient.to,
            subject: recipient.rendered.subject,
            text: recipient.rendered.text,
            html: recipient.rendered.html,
          }),
        ],
      );
      if (!email.deduplicated || requeued.rowCount) queued++;
    }
  });
  wakeEmailOutbox();
  return { queued, skipped };
}
