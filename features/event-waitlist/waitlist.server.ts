import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";

import { normaliseEventInput, type EventInput } from "@/features/events/events.server";
import { getEventWithClient } from "@/features/events/store.server";
import { isUpcoming, ticketTypeSalesState, type EventRecord } from "@/features/events/types";
import {
  getTicketCapacitySnapshotWithClient,
  type TicketCapacitySnapshot,
} from "@/features/tickets/capacity.server";
import {
  enqueueEmailInTransaction,
  hashEmailRecipient,
  maskEmailRecipient,
  wakeEmailOutbox,
} from "@/lib/platform/email-outbox.server";
import { log } from "@/lib/platform/logger.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import { reserveRateLimit } from "@/lib/platform/rate-limit.server";
import { assessEmailAddress, normaliseEmail } from "@/lib/shared/email-address";
import { eventPath } from "@/features/events/routes";
import { buildWaitlistAvailabilityEmail, buildWaitlistConfirmationEmail } from "./email.server";
import {
  WAITLIST_STATUSES,
  type AdminWaitlistEntry,
  type WaitlistAdminView,
  type WaitlistImpact,
  type WaitlistManagementView,
  type WaitlistScope,
  type WaitlistStatus,
} from "./types";

const MANAGEMENT_TOKEN_LABEL = "milk-and-henny:event-waitlist-management:v1";
const CONFIRMATION_WINDOW_MS = 48 * 60 * 60 * 1_000;
const AVAILABILITY_DELIVERY_WINDOW_MS = 24 * 60 * 60 * 1_000;
const EVENT_SCOPE_KEY = "event";
const TYPE_SCOPE_PREFIX = "ticket:";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type WaitlistResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

type RequestWaitlistOutcome =
  | { queued: boolean }
  | { queued: false; status: number; error: string };

type ManagementUpdateOutcome =
  | { eventSlug: string; confirmed: boolean }
  | { status: number; error: string };

interface WaitlistRow {
  id: string;
  event_slug: string;
  scope_kind: WaitlistScope["kind"];
  ticket_type_id: string | null;
  scope_label: string | null;
  email: string;
  email_hash: string;
  status: WaitlistStatus;
  confirmation_version: number;
  confirmed_at: Date | null;
  notified_at: Date | null;
  left_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface AdminWaitlistRow extends WaitlistRow {
  ticket_type_name: string | null;
}

interface InventorySnapshot {
  eventAvailable: number;
  byType: Record<string, number>;
  sharedCapacityBinding: boolean;
}

interface NotificationCandidate extends WaitlistRow {
  ticket_type_name: string | null;
}

interface NotificationSelection {
  row: NotificationCandidate;
  label: string;
  capacityTypeId: string;
}

interface InventoryState {
  available: Record<string, number>;
  credits: Record<string, number>;
}

interface NotificationPlan {
  selections: NotificationSelection[];
  credits: Record<string, number>;
}

function signingKey(): Buffer | null {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) return null;
  return createHmac("sha256", secret).update(MANAGEMENT_TOKEN_LABEL).digest();
}

function managementSignature(id: string, confirmationVersion: number): string | null {
  const key = signingKey();
  return key
    ? createHmac("sha256", key).update(`${id}.${confirmationVersion}`).digest("base64url")
    : null;
}

export function createWaitlistManagementToken(
  id: string,
  confirmationVersion: number,
): string | null {
  if (
    !UUID_PATTERN.test(id) ||
    !Number.isSafeInteger(confirmationVersion) ||
    confirmationVersion < 1
  ) {
    return null;
  }
  const signature = managementSignature(id, confirmationVersion);
  return signature ? `${id}.${confirmationVersion}.${signature}` : null;
}

function entryFromToken(token: string): { id: string; confirmationVersion: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id = "", rawVersion = "", supplied = ""] = parts;
  const confirmationVersion = Number(rawVersion);
  if (
    !UUID_PATTERN.test(id) ||
    !/^[1-9][0-9]{0,9}$/.test(rawVersion) ||
    !Number.isSafeInteger(confirmationVersion) ||
    !/^[A-Za-z0-9_-]{40,48}$/.test(supplied)
  ) {
    return null;
  }
  const expected = managementSignature(id, confirmationVersion);
  if (!expected) return null;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
    ? { id, confirmationVersion }
    : null;
}

function scopeKey(ticketTypeId: string | null): string {
  return ticketTypeId ? `${TYPE_SCOPE_PREFIX}${ticketTypeId}` : EVENT_SCOPE_KEY;
}

function scopeTicketTypeId(scope: WaitlistScope): string | null {
  return scope.kind === "ticket-type" ? scope.ticketTypeId : null;
}

function isWaitlistScope(value: unknown): value is WaitlistScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const scope = value as Record<string, unknown>;
  return (
    scope.kind === "event" ||
    (scope.kind === "ticket-type" &&
      typeof scope.ticketTypeId === "string" &&
      scope.ticketTypeId.length > 0 &&
      scope.ticketTypeId.length <= 80)
  );
}

function activeSalesState(event: EventRecord, typeId: string, occupied: number) {
  const type = event.ticketTypes.find((entry) => entry.id === typeId);
  return type ? ticketTypeSalesState(event, type, occupied) : { state: "none" as const };
}

export function waitlistInventorySnapshot(
  event: EventRecord,
  capacity: TicketCapacitySnapshot,
  now = Date.now(),
): InventorySnapshot {
  const empty = {
    eventAvailable: 0,
    byType: Object.fromEntries(event.ticketTypes.map((type) => [type.id, 0])),
    sharedCapacityBinding: false,
  };
  if (!event.waitlistEnabled || event.status !== "published" || !isUpcoming(event, now)) {
    return empty;
  }

  const soldTotal = Object.values(capacity.sold).reduce((sum, count) => sum + count, 0);
  const checkoutTotal = Object.values(capacity.checkoutReserved).reduce(
    (sum, count) => sum + count,
    0,
  );
  const eventRemaining =
    event.capacity === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, event.capacity - soldTotal - checkoutTotal);
  const rawByType: Record<string, number> = {};
  for (const type of event.ticketTypes) {
    const occupied =
      (capacity.sold[type.id] ?? 0) +
      (capacity.checkoutReserved[type.id] ?? 0) +
      (capacity.exchangeReserved[type.id] ?? 0);
    const sales = ticketTypeSalesState(event, type, occupied, now);
    rawByType[type.id] =
      !type.hidden && sales.state === "on-sale" ? Math.max(0, type.quantity - occupied) : 0;
  }
  const rawTotal = Object.values(rawByType).reduce((sum, count) => sum + count, 0);
  const eventAvailable = Math.max(0, Math.min(rawTotal, eventRemaining));
  return {
    eventAvailable,
    byType: Object.fromEntries(
      Object.entries(rawByType).map(([typeId, remaining]) => [
        typeId,
        Math.min(remaining, eventAvailable),
      ]),
    ),
    sharedCapacityBinding: Number.isFinite(eventRemaining) && eventRemaining < rawTotal,
  };
}

function positiveDifference(current: number, previous: number): number {
  return Math.max(0, current - previous);
}

function planNotifications(input: {
  event: EventRecord;
  inventory: InventorySnapshot;
  previous: Record<string, number>;
  credits?: Record<string, number>;
  candidates: NotificationCandidate[];
}): NotificationPlan {
  const credits: Record<string, number> = {};
  const typeDeltas: number[] = [];
  for (const type of input.event.ticketTypes) {
    const key = scopeKey(type.id);
    const available = input.inventory.byType[type.id] ?? 0;
    const delta = positiveDifference(available, input.previous[key] ?? 0);
    typeDeltas.push(delta);
    credits[key] = Math.min(available, (input.credits?.[key] ?? 0) + delta);
  }
  const eventDelta = positiveDifference(
    input.inventory.eventAvailable,
    input.previous[EVENT_SCOPE_KEY] ?? 0,
  );
  const capacityDelta = input.inventory.sharedCapacityBinding
    ? Math.max(eventDelta, ...typeDeltas, 0)
    : Math.max(
        eventDelta,
        typeDeltas.reduce((sum, delta) => sum + delta, 0),
      );
  credits[EVENT_SCOPE_KEY] = Math.min(
    input.inventory.eventAvailable,
    (input.credits?.[EVENT_SCOPE_KEY] ?? 0) + capacityDelta,
  );

  const capacityTypeFor = (row: NotificationCandidate): string | null => {
    if ((credits[EVENT_SCOPE_KEY] ?? 0) <= 0) return null;
    if (row.ticket_type_id) {
      return (credits[scopeKey(row.ticket_type_id)] ?? 0) > 0 ? row.ticket_type_id : null;
    }
    return (
      input.event.ticketTypes.find(
        (type) =>
          (input.inventory.byType[type.id] ?? 0) > 0 && (credits[scopeKey(type.id)] ?? 0) > 0,
      )?.id ?? null
    );
  };

  const selections: NotificationSelection[] = [];
  for (const row of input.candidates) {
    const capacityTypeId = capacityTypeFor(row);
    if (!capacityTypeId) continue;
    credits[EVENT_SCOPE_KEY] = Math.max(0, (credits[EVENT_SCOPE_KEY] ?? 0) - 1);
    const typeKey = scopeKey(capacityTypeId);
    credits[typeKey] = Math.max(0, (credits[typeKey] ?? 0) - 1);
    selections.push({
      row,
      label: row.ticket_type_name ?? "any ticket",
      capacityTypeId,
    });
  }
  return { selections, credits };
}

function selectNotifications(input: {
  event: EventRecord;
  inventory: InventorySnapshot;
  previous: Record<string, number>;
  credits?: Record<string, number>;
  candidates: NotificationCandidate[];
}): NotificationSelection[] {
  return planNotifications(input).selections;
}

async function readInventoryState(client: PoolClient, eventSlug: string): Promise<InventoryState> {
  const result = await client.query<{ scope_key: string; available: number; credits: number }>(
    `select scope_key, available, credits
       from event_waitlist_inventory where event_slug = $1`,
    [eventSlug],
  );
  return {
    available: Object.fromEntries(result.rows.map((row) => [row.scope_key, row.available])),
    credits: Object.fromEntries(result.rows.map((row) => [row.scope_key, row.credits])),
  };
}

async function writeInventoryState(
  client: PoolClient,
  event: EventRecord,
  inventory: InventorySnapshot,
  credits: Record<string, number>,
): Promise<void> {
  const states = [
    [
      EVENT_SCOPE_KEY,
      inventory.eventAvailable,
      Math.min(inventory.eventAvailable, credits[EVENT_SCOPE_KEY] ?? 0),
    ] as const,
    ...event.ticketTypes.map(
      (type) =>
        [
          scopeKey(type.id),
          inventory.byType[type.id] ?? 0,
          Math.min(inventory.byType[type.id] ?? 0, credits[scopeKey(type.id)] ?? 0),
        ] as const,
    ),
  ];
  for (const [key, available, remainingCredits] of states) {
    await client.query(
      `insert into event_waitlist_inventory (event_slug, scope_key, available, credits)
       values ($1,$2,$3,$4)
       on conflict (event_slug, scope_key) do update
         set available = excluded.available, credits = excluded.credits, updated_at = now()`,
      [event.slug, key, available, remainingCredits],
    );
  }
  await client.query(
    `delete from event_waitlist_inventory
      where event_slug = $1 and not (scope_key = any($2::text[]))`,
    [event.slug, states.map(([key]) => key)],
  );
}

async function initializeInventoryState(
  client: PoolClient,
  event: EventRecord,
  inventory: InventorySnapshot,
): Promise<void> {
  const states = [
    [EVENT_SCOPE_KEY, inventory.eventAvailable] as const,
    ...event.ticketTypes.map(
      (type) => [scopeKey(type.id), inventory.byType[type.id] ?? 0] as const,
    ),
  ];
  for (const [key, available] of states) {
    await client.query(
      `insert into event_waitlist_inventory (event_slug, scope_key, available, credits)
       values ($1,$2,$3,0)
       on conflict (event_slug, scope_key) do update
         set available = least(event_waitlist_inventory.available, excluded.available),
             credits = least(event_waitlist_inventory.credits, excluded.available),
             updated_at = now()`,
      [event.slug, key, available],
    );
  }
}

async function activeCandidates(
  client: PoolClient,
  eventSlug: string,
): Promise<NotificationCandidate[]> {
  const result = await client.query<NotificationCandidate>(
    `select entry.*, coalesce(type.name, entry.scope_label) as ticket_type_name
       from event_waitlist_entries entry
       left join ticket_types type
         on type.event_slug = entry.event_slug and type.id = entry.ticket_type_id
      where entry.event_slug = $1 and entry.status = 'active'
      order by entry.confirmed_at asc nulls last, entry.created_at asc, entry.id asc
      for update of entry`,
    [eventSlug],
  );
  return result.rows;
}

function impactFromSelections(selections: NotificationSelection[]): WaitlistImpact {
  const grouped = new Map<string, { ticketTypeId?: string; label: string; count: number }>();
  for (const selection of selections) {
    const key = selection.row.ticket_type_id ?? EVENT_SCOPE_KEY;
    const current = grouped.get(key);
    if (current) current.count += 1;
    else {
      grouped.set(key, {
        ...(selection.row.ticket_type_id ? { ticketTypeId: selection.row.ticket_type_id } : {}),
        label: selection.label,
        count: 1,
      });
    }
  }
  return { count: selections.length, scopes: [...grouped.values()] };
}

function terminalEvent(event: EventRecord): boolean {
  return event.status === "cancelled" || event.status === "archived" || !isUpcoming(event);
}

function messageExpiry(event: EventRecord, maximumAgeMs: number): Date {
  const eventEnd = Date.parse(event.endsAt ?? event.startsAt);
  const maximum = Date.now() + maximumAgeMs;
  return new Date(Number.isFinite(eventEnd) ? Math.min(eventEnd, maximum) : maximum);
}

export async function reconcileEventWaitlist(input: {
  eventSlug: string;
  origin: string;
  deliverNow?: boolean;
}): Promise<WaitlistImpact> {
  const result = await transaction(async (client) => {
    const event = await getEventWithClient(client, input.eventSlug, { forUpdate: true });
    if (!event) return { impact: { count: 0, scopes: [] }, queued: false };

    if (terminalEvent(event)) {
      await client.query(
        `update event_waitlist_entries
            set status = 'expired', updated_at = now()
          where event_slug = $1 and status in ('pending', 'active')`,
        [event.slug],
      );
    }
    await client.query(
      `update event_waitlist_entries
          set status = 'expired', updated_at = now()
        where event_slug = $1 and status = 'pending'
          and created_at < now() - interval '48 hours'`,
      [event.slug],
    );
    await client.query(
      `update event_waitlist_entries entry
          set status = 'undeliverable', updated_at = now()
        where entry.event_slug = $1 and entry.status in ('pending', 'active')
          and exists (
            select 1 from email_suppressions suppression
             where suppression.recipient_hash = entry.email_hash
          )`,
      [event.slug],
    );
    await client.query(
      `update event_waitlist_entries
          set status = 'expired', updated_at = now()
        where event_slug = $1 and scope_kind = 'ticket-type'
          and ticket_type_id is null and status in ('pending', 'active')`,
      [event.slug],
    );

    const capacity = await getTicketCapacitySnapshotWithClient(client, event.slug);
    const state = await readInventoryState(client, event.slug);
    const candidates = await activeCandidates(client, event.slug);
    const inventory = waitlistInventorySnapshot(event, capacity);
    const plan = planNotifications({
      event,
      inventory,
      previous: state.available,
      credits: state.credits,
      candidates,
    });
    let queued = false;
    const deliveredSelections: NotificationSelection[] = [];

    for (const selection of plan.selections) {
      const delivery = await enqueueEmailInTransaction(
        client,
        buildWaitlistAvailabilityEmail({
          event,
          email: selection.row.email,
          ticketTypeName: selection.row.ticket_type_name ?? undefined,
          origin: input.origin,
        }),
        {
          idempotencyKey: `waitlist:availability:${selection.row.id}`,
          kind: "waitlist-availability",
          source: "system",
          context: { eventSlug: event.slug, waitlistEntryId: selection.row.id },
          contentExpiresAt: messageExpiry(event, AVAILABILITY_DELIVERY_WINDOW_MS),
        },
      );
      if (!delivery.ok) {
        await client.query(
          `update event_waitlist_entries
              set status = 'undeliverable', updated_at = now()
            where id = $1 and status = 'active'`,
          [selection.row.id],
        );
        plan.credits[EVENT_SCOPE_KEY] = Math.min(
          inventory.eventAvailable,
          (plan.credits[EVENT_SCOPE_KEY] ?? 0) + 1,
        );
        const typeKey = scopeKey(selection.capacityTypeId);
        plan.credits[typeKey] = Math.min(
          inventory.byType[selection.capacityTypeId] ?? 0,
          (plan.credits[typeKey] ?? 0) + 1,
        );
        continue;
      }
      queued = true;
      deliveredSelections.push(selection);
      await client.query(
        `update event_waitlist_entries
            set status = 'notified', notified_at = now(), updated_at = now()
          where id = $1 and status = 'active'`,
        [selection.row.id],
      );
    }

    await writeInventoryState(client, event, inventory, plan.credits);
    return { impact: impactFromSelections(deliveredSelections), queued };
  });
  if (result.queued && input.deliverNow !== false) wakeEmailOutbox();
  if (result.impact.count > 0) {
    log.info("events.waitlist", "Availability alerts queued", {
      eventSlug: input.eventSlug,
      count: result.impact.count,
    });
  }
  return result.impact;
}

function scopeCanJoin(
  event: EventRecord,
  capacity: TicketCapacitySnapshot,
  inventory: InventorySnapshot,
  scope: WaitlistScope,
): boolean {
  if (!event.waitlistEnabled || !isUpcoming(event)) return false;
  if (event.status !== "published" && event.status !== "sold-out") return false;
  if (scope.kind === "ticket-type") {
    const type = event.ticketTypes.find(
      (candidate) => candidate.id === scope.ticketTypeId && !candidate.hidden,
    );
    if (!type || (inventory.byType[type.id] ?? 0) > 0) return false;
    const occupied =
      (capacity.sold[type.id] ?? 0) +
      (capacity.checkoutReserved[type.id] ?? 0) +
      (capacity.exchangeReserved[type.id] ?? 0);
    const sales = activeSalesState(event, type.id, occupied);
    return sales.state === "on-sale" || sales.state === "sold-out";
  }
  if (inventory.eventAvailable > 0) return false;
  const visible = event.ticketTypes.filter((type) => !type.hidden);
  return (
    visible.length > 0 &&
    visible.every((type) => {
      const occupied =
        (capacity.sold[type.id] ?? 0) +
        (capacity.checkoutReserved[type.id] ?? 0) +
        (capacity.exchangeReserved[type.id] ?? 0);
      const sales = activeSalesState(event, type.id, occupied);
      return (
        (inventory.byType[type.id] ?? 0) === 0 &&
        (sales.state === "on-sale" || sales.state === "sold-out")
      );
    })
  );
}

async function waitlistRateLimit(ip: string, emailHash: string): Promise<boolean> {
  const [ipDecision, emailDecision] = await Promise.all([
    reserveRateLimit({
      name: "event-waitlist-ip",
      identity: ip || "unknown",
      limit: 12,
      windowSeconds: 60 * 60,
    }),
    reserveRateLimit({
      name: "event-waitlist-email",
      identity: emailHash,
      limit: 5,
      windowSeconds: 60 * 60,
    }),
  ]);
  return ipDecision.allowed && emailDecision.allowed;
}

export async function requestEventWaitlist(input: {
  eventSlug: string;
  email: string;
  scope: WaitlistScope;
  origin: string;
  ip: string;
  deliverNow?: boolean;
}): Promise<WaitlistResult<void>> {
  if (
    typeof input.eventSlug !== "string" ||
    typeof input.email !== "string" ||
    !isWaitlistScope(input.scope)
  ) {
    return { ok: false, status: 400, error: "Invalid waitlist request" };
  }
  const assessment = assessEmailAddress(input.email);
  if (!assessment.valid) {
    return { ok: false, status: 400, error: assessment.message ?? "Enter a valid email address" };
  }
  if (!signingKey()) {
    return { ok: false, status: 503, error: "Waitlist confirmation is not configured" };
  }
  const email = normaliseEmail(input.email);
  const emailHash = hashEmailRecipient(email);
  if (!(await waitlistRateLimit(input.ip, emailHash))) {
    return { ok: false, status: 429, error: "Too many waitlist requests. Try again later." };
  }

  const outcome = await transaction<RequestWaitlistOutcome>(async (client) => {
    const event = await getEventWithClient(client, input.eventSlug, { forUpdate: true });
    if (!event) return { error: "Event not found", status: 404, queued: false } as const;
    const capacity = await getTicketCapacitySnapshotWithClient(client, event.slug);
    const inventory = waitlistInventorySnapshot(event, capacity);
    if (!scopeCanJoin(event, capacity, inventory, input.scope)) {
      return {
        error:
          inventory.eventAvailable > 0 ? "Tickets are available now" : "This waitlist is not open",
        status: 409,
        queued: false,
      } as const;
    }

    await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `event-waitlist:${event.slug}:${emailHash}`,
    ]);
    const existingResult = await client.query<WaitlistRow>(
      `select * from event_waitlist_entries
        where event_slug = $1 and email_hash = $2 and status in ('pending', 'active')
        limit 1 for update`,
      [event.slug, emailHash],
    );
    const existing = existingResult.rows[0];
    if (existing?.status === "active") return { queued: false } as const;

    const ticketTypeId = scopeTicketTypeId(input.scope);
    const scopeLabel = ticketTypeId
      ? (event.ticketTypes.find((type) => type.id === ticketTypeId)?.name ?? null)
      : null;
    let entry: WaitlistRow;
    if (existing) {
      const updated = await client.query<WaitlistRow>(
        `update event_waitlist_entries
            set scope_kind = $2, ticket_type_id = $3, scope_label = $4, email = $5,
                confirmation_version = confirmation_version + 1,
                created_at = now(), updated_at = now()
          where id = $1
          returning *`,
        [existing.id, input.scope.kind, ticketTypeId, scopeLabel, email],
      );
      entry = updated.rows[0]!;
    } else {
      const id = randomUUID();
      const inserted = await client.query<WaitlistRow>(
        `insert into event_waitlist_entries
           (id,event_slug,scope_kind,ticket_type_id,scope_label,email,email_hash)
         values ($1,$2,$3,$4,$5,$6,$7)
         returning *`,
        [id, event.slug, input.scope.kind, ticketTypeId, scopeLabel, email, emailHash],
      );
      entry = inserted.rows[0]!;
    }
    const managementToken = createWaitlistManagementToken(entry.id, entry.confirmation_version);
    if (!managementToken) throw new Error("Waitlist management token could not be signed");
    const ticketTypeName = scopeLabel ?? undefined;
    const delivery = await enqueueEmailInTransaction(
      client,
      buildWaitlistConfirmationEmail({
        event,
        email,
        ticketTypeName,
        managementToken,
        origin: input.origin,
      }),
      {
        idempotencyKey: `waitlist:confirmation:${entry.id}:${entry.confirmation_version}`,
        kind: "waitlist-confirmation",
        source: "self-service",
        context: { eventSlug: event.slug, waitlistEntryId: entry.id },
        contentExpiresAt: messageExpiry(event, CONFIRMATION_WINDOW_MS),
      },
    );
    if (!delivery.ok) {
      await client.query(
        `update event_waitlist_entries
            set status = 'undeliverable', updated_at = now()
          where id = $1`,
        [entry.id],
      );
      return { queued: false } as const;
    }
    await initializeInventoryState(client, event, inventory);
    return { queued: true } as const;
  });

  if ("error" in outcome) {
    return { ok: false, status: outcome.status, error: outcome.error };
  }
  if (outcome.queued && input.deliverNow !== false) wakeEmailOutbox();
  return { ok: true, value: undefined };
}

function confirmationExpired(row: WaitlistRow): boolean {
  return row.status === "pending" && Date.now() - row.created_at.getTime() > CONFIRMATION_WINDOW_MS;
}

function toManagementView(
  row: WaitlistRow & { event_title: string; ticket_type_name: string | null },
): WaitlistManagementView {
  return {
    eventSlug: row.event_slug,
    eventTitle: row.event_title,
    eventPath: eventPath(row.event_slug),
    scopeLabel: row.ticket_type_name ?? "any ticket",
    emailHint: maskEmailRecipient(row.email),
    status: row.status,
    confirmationExpired: confirmationExpired(row),
  };
}

export async function getWaitlistManagement(
  token: string,
): Promise<WaitlistResult<WaitlistManagementView>> {
  if (typeof token !== "string") {
    return { ok: false, status: 404, error: "This waitlist link is not recognised" };
  }
  const entryToken = entryFromToken(token);
  if (!entryToken) {
    return { ok: false, status: 404, error: "This waitlist link is not recognised" };
  }
  const rows = await query<WaitlistRow & { event_title: string; ticket_type_name: string | null }>(
    `select entry.*, event.title as event_title,
            coalesce(type.name, entry.scope_label) as ticket_type_name
       from event_waitlist_entries entry
       join events event on event.slug = entry.event_slug
       left join ticket_types type
         on type.event_slug = entry.event_slug and type.id = entry.ticket_type_id
      where entry.id = $1 and entry.confirmation_version = $2`,
    [entryToken.id, entryToken.confirmationVersion],
  );
  const row = rows[0];
  return row
    ? { ok: true, value: toManagementView(row) }
    : { ok: false, status: 404, error: "This waitlist link is no longer available" };
}

export async function updateWaitlistManagement(input: {
  token: string;
  action: "confirm" | "leave";
  origin: string;
  deliverNow?: boolean;
}): Promise<WaitlistResult<WaitlistManagementView>> {
  if (typeof input.token !== "string" || (input.action !== "confirm" && input.action !== "leave")) {
    return { ok: false, status: 400, error: "Invalid waitlist action" };
  }
  const entryToken = entryFromToken(input.token);
  if (!entryToken) {
    return { ok: false, status: 404, error: "This waitlist link is not recognised" };
  }
  const changed = await transaction<ManagementUpdateOutcome>(async (client) => {
    const lookup = await client.query<Pick<WaitlistRow, "event_slug">>(
      `select event_slug from event_waitlist_entries
        where id = $1 and confirmation_version = $2`,
      [entryToken.id, entryToken.confirmationVersion],
    );
    const eventSlug = lookup.rows[0]?.event_slug;
    if (!eventSlug) {
      return { error: "This waitlist link is no longer available", status: 404 } as const;
    }
    // Every waitlist mutation takes the event lock before entry locks. Keeping
    // this order aligned with reconciliation prevents confirmation/alert deadlocks.
    const event = await getEventWithClient(client, eventSlug, { forUpdate: true });
    if (!event) return { error: "This event is no longer available", status: 410 } as const;
    const result = await client.query<WaitlistRow>(
      `select * from event_waitlist_entries
        where id = $1 and confirmation_version = $2 for update`,
      [entryToken.id, entryToken.confirmationVersion],
    );
    const row = result.rows[0];
    if (!row) return { error: "This waitlist link is no longer available", status: 404 } as const;

    if (input.action === "leave") {
      if (row.status === "pending" || row.status === "active") {
        await client.query(
          `update event_waitlist_entries
              set status = 'left', left_at = now(), updated_at = now()
            where id = $1`,
          [row.id],
        );
      }
      return { eventSlug: event.slug, confirmed: false } as const;
    }

    if (row.status === "pending") {
      if (confirmationExpired(row) || terminalEvent(event) || !event.waitlistEnabled) {
        await client.query(
          `update event_waitlist_entries set status = 'expired', updated_at = now() where id = $1`,
          [row.id],
        );
        return { eventSlug: event.slug, confirmed: false } as const;
      }
      await client.query(
        `update event_waitlist_entries
            set status = 'active', confirmed_at = now(), updated_at = now()
          where id = $1`,
        [row.id],
      );
      return { eventSlug: event.slug, confirmed: true } as const;
    }
    return { eventSlug: event.slug, confirmed: false } as const;
  });
  if ("error" in changed) {
    return { ok: false, status: changed.status, error: changed.error };
  }
  if (changed.confirmed) {
    await reconcileEventWaitlist({
      eventSlug: changed.eventSlug,
      origin: input.origin,
      deliverNow: input.deliverNow,
    });
  }
  return getWaitlistManagement(input.token);
}

export async function listEventWaitlist(eventSlug: string): Promise<WaitlistAdminView> {
  const [countRows, entries] = await Promise.all([
    query<{ status: WaitlistStatus; count: string }>(
      `select status, count(*)::text as count
         from event_waitlist_entries where event_slug = $1 group by status`,
      [eventSlug],
    ),
    query<AdminWaitlistRow>(
      `select entry.*, coalesce(type.name, entry.scope_label) as ticket_type_name
         from event_waitlist_entries entry
         left join ticket_types type
           on type.event_slug = entry.event_slug and type.id = entry.ticket_type_id
        where entry.event_slug = $1
        order by case entry.status when 'active' then 0 when 'pending' then 1 else 2 end,
                 entry.created_at desc
        limit 500`,
      [eventSlug],
    ),
  ]);
  const counts = Object.fromEntries(WAITLIST_STATUSES.map((status) => [status, 0])) as Record<
    WaitlistStatus,
    number
  >;
  for (const row of countRows) counts[row.status] = Number(row.count);
  const views: AdminWaitlistEntry[] = entries.map((row) => ({
    id: row.id,
    email: row.email,
    scopeLabel: row.ticket_type_name ?? "any ticket",
    ...(row.ticket_type_id ? { ticketTypeId: row.ticket_type_id } : {}),
    status: row.status,
    createdAt: row.created_at.toISOString(),
    ...(row.confirmed_at ? { confirmedAt: row.confirmed_at.toISOString() } : {}),
    ...(row.notified_at ? { notifiedAt: row.notified_at.toISOString() } : {}),
    ...(row.left_at ? { leftAt: row.left_at.toISOString() } : {}),
  }));
  return { counts, entries: views };
}

export async function previewWaitlistImpact(
  eventSlug: string,
  candidateInput: EventInput,
): Promise<WaitlistResult<WaitlistImpact>> {
  return transaction(async (client) => {
    const existing = await getEventWithClient(client, eventSlug);
    if (!existing) return { ok: false, status: 404, error: "Event not found" };
    const candidate = normaliseEventInput(candidateInput, existing);
    if (!candidate.ok) return candidate;
    const capacity = await getTicketCapacitySnapshotWithClient(client, eventSlug);
    const state = await readInventoryState(client, eventSlug);
    const candidates = await activeCandidates(client, eventSlug);
    const inventory = waitlistInventorySnapshot(candidate.value, capacity);
    return {
      ok: true,
      value: impactFromSelections(
        selectNotifications({
          event: candidate.value,
          inventory,
          previous: state.available,
          credits: state.credits,
          candidates,
        }),
      ),
    };
  });
}

export async function reconcileActiveWaitlists(origin: string): Promise<number> {
  const events = await query<{ event_slug: string }>(
    `select distinct event_slug
       from event_waitlist_entries
      where status in ('pending', 'active')
      order by event_slug`,
  );
  let queued = 0;
  for (const event of events) {
    try {
      queued += (await reconcileEventWaitlist({ eventSlug: event.event_slug, origin })).count;
    } catch (error) {
      log.error(
        "events.waitlist",
        "Waitlist reconciliation failed",
        { eventSlug: event.event_slug },
        error,
      );
    }
  }
  return queued;
}

export const __waitlistTesting = { selectNotifications };
