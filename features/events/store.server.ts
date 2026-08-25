import type { PoolClient } from "pg";

import { log } from "@/lib/platform/logger.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import {
  isEventHeroHeight,
  isPubliclyVisible,
  isValidEventSlug,
  type EventRecord,
  type TicketType,
} from "./types";

/**
 * Event persistence.
 *
 * Ticket types are a real table rather than a JSON column, because capacity
 * is enforced by counting ticket rows against `quantity` under a row lock —
 * see `features/tickets/store.server.ts`. A JSON blob could not be locked.
 */

type EventRow = {
  event_id: string;
  slug: string;
  title: string;
  tagline: string | null;
  status: string;
  starts_at: Date;
  ends_at: Date | null;
  doors_at: Date | null;
  last_entry_at: Date | null;
  timezone: string;
  area: string | null;
  venue_name: string | null;
  address: string | null;
  door_code: string | null;
  three_word_hint: string | null;
  map_url: string | null;
  step_free_access: boolean | null;
  transport_note: string | null;
  description: string | null;
  lineup: unknown;
  dress_code: string | null;
  age_limit: string | null;
  house_rules: string | null;
  hero_image: string | null;
  hero_image_width: number | null;
  hero_image_height: number | null;
  hero_height: string | null;
  og_image: string | null;
  marketing_path: string | null;
  capacity: number | null;
  waitlist_enabled: boolean;
  refund_policy: string | null;
  transferable: boolean;
  terms: string | null;
  check_in_opens_at: Date | null;
  staff_notes: string | null;
  created_at: Date;
  updated_at: Date;
};

type TicketTypeRow = {
  event_slug: string;
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
  position: number;
};

const EVENT_COLUMNS = `
  event_id, slug, title, tagline, status, starts_at, ends_at, doors_at, last_entry_at, timezone,
  area, venue_name, address, door_code, three_word_hint, map_url, step_free_access,
  transport_note, description, lineup, dress_code, age_limit, house_rules, hero_image,
  hero_image_width, hero_image_height, hero_height, og_image, marketing_path, capacity,
  waitlist_enabled, refund_policy, transferable, terms,
  check_in_opens_at, staff_notes, created_at, updated_at
`;

function optional(value: string | null): string | undefined {
  return value === null ? undefined : value;
}

function instant(value: Date | null): string | undefined {
  return value === null ? undefined : value.toISOString();
}

function toTicketType(row: TicketTypeRow): TicketType {
  return {
    id: row.id,
    name: row.name,
    description: optional(row.description),
    priceMinor: row.price_minor,
    currency: row.currency,
    quantity: row.quantity,
    perPersonLimit: row.per_person_limit,
    salesStart: instant(row.sales_start),
    salesEnd: instant(row.sales_end),
    hidden: row.hidden,
  };
}

function toEvent(row: EventRow, ticketTypes: TicketType[]): EventRecord {
  return {
    eventId: row.event_id,
    slug: row.slug,
    title: row.title,
    tagline: optional(row.tagline),
    status: row.status as EventRecord["status"],
    startsAt: row.starts_at.toISOString(),
    endsAt: instant(row.ends_at),
    doorsAt: instant(row.doors_at),
    lastEntryAt: instant(row.last_entry_at),
    timezone: row.timezone,
    area: optional(row.area),
    venueName: optional(row.venue_name),
    address: optional(row.address),
    doorCode: optional(row.door_code),
    threeWordHint: optional(row.three_word_hint),
    mapUrl: optional(row.map_url),
    stepFreeAccess: row.step_free_access ?? undefined,
    transportNote: optional(row.transport_note),
    description: optional(row.description),
    lineup: Array.isArray(row.lineup) ? (row.lineup as string[]) : [],
    dressCode: optional(row.dress_code),
    ageLimit: optional(row.age_limit),
    houseRules: optional(row.house_rules),
    heroImage: optional(row.hero_image),
    heroImageWidth: row.hero_image_width ?? undefined,
    heroImageHeight: row.hero_image_height ?? undefined,
    heroHeight: isEventHeroHeight(row.hero_height) ? row.hero_height : undefined,
    ogImage: optional(row.og_image),
    marketingPath: optional(row.marketing_path),
    ticketTypes,
    capacity: row.capacity ?? undefined,
    waitlistEnabled: row.waitlist_enabled,
    refundPolicy: optional(row.refund_policy),
    transferable: row.transferable,
    terms: optional(row.terms),
    checkInOpensAt: instant(row.check_in_opens_at),
    staffNotes: optional(row.staff_notes),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Attach ticket types to a set of events with one extra query, not N. */
async function withTicketTypes(rows: EventRow[]): Promise<EventRecord[]> {
  if (rows.length === 0) return [];

  const slugs = rows.map((row) => row.slug);
  const typeRows = await query<TicketTypeRow>(
    `select * from ticket_types where event_slug = any($1::text[]) order by position, id`,
    [slugs],
  );

  const bySlug = new Map<string, TicketType[]>();
  for (const typeRow of typeRows) {
    const list = bySlug.get(typeRow.event_slug) ?? [];
    list.push(toTicketType(typeRow));
    bySlug.set(typeRow.event_slug, list);
  }

  return rows.map((row) => toEvent(row, bySlug.get(row.slug) ?? []));
}

export async function getEvent(slug: string): Promise<EventRecord | null> {
  if (!isValidEventSlug(slug)) return null;
  const rows = await query<EventRow>(`select ${EVENT_COLUMNS} from events where slug = $1`, [slug]);
  const events = await withTicketTypes(rows);
  return events[0] ?? null;
}

export async function getEvents(slugs: string[]): Promise<EventRecord[]> {
  const safe = slugs.filter(isValidEventSlug);
  if (safe.length === 0) return [];
  const rows = await query<EventRow>(
    `select ${EVENT_COLUMNS} from events where slug = any($1::text[]) order by starts_at desc`,
    [safe],
  );
  return withTicketTypes(rows);
}

export type ListEventsOptions = {
  /** Include drafts and archives. Admin surfaces only. */
  includeHidden?: boolean;
  limit?: number;
};

export async function listEvents(options: ListEventsOptions = {}): Promise<EventRecord[]> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const rows = await query<EventRow>(
    `select ${EVENT_COLUMNS} from events order by starts_at desc limit $1`,
    [limit],
  );
  const events = await withTicketTypes(rows);
  return options.includeHidden ? events : events.filter(isPubliclyVisible);
}

async function replaceTicketTypes(
  client: PoolClient,
  slug: string,
  ticketTypes: TicketType[],
): Promise<void> {
  const keep = ticketTypes.map((type) => type.id);

  // Removing a type that already sold tickets is blocked by the foreign key,
  // which is the intended behaviour: you cannot delete a type out from under
  // someone's ticket.
  await client.query(
    `delete from ticket_types where event_slug = $1 and not (id = any($2::text[]))`,
    [slug, keep],
  );

  for (const [position, type] of ticketTypes.entries()) {
    await client.query(
      `insert into ticket_types (
         event_slug, id, name, description, price_minor, currency, quantity,
         per_person_limit, sales_start, sales_end, hidden, position
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (event_slug, id) do update set
         name = excluded.name,
         description = excluded.description,
         price_minor = excluded.price_minor,
         currency = excluded.currency,
         quantity = excluded.quantity,
         per_person_limit = excluded.per_person_limit,
         sales_start = excluded.sales_start,
         sales_end = excluded.sales_end,
         hidden = excluded.hidden,
         position = excluded.position`,
      [
        slug,
        type.id,
        type.name,
        type.description ?? null,
        type.priceMinor,
        type.currency,
        type.quantity,
        type.perPersonLimit,
        type.salesStart ?? null,
        type.salesEnd ?? null,
        type.hidden,
        position,
      ],
    );
  }
}

export async function putEvent(
  event: EventRecord,
  options: { renameFrom?: string } = {},
): Promise<void> {
  if (!isValidEventSlug(event.slug)) {
    throw new Error(`Refusing to store event with invalid slug: ${event.slug}`);
  }

  await transaction(async (client) => {
    if (options.renameFrom && options.renameFrom !== event.slug) {
      if (!isValidEventSlug(options.renameFrom)) throw new Error("Invalid event slug");
      const existing = await client.query<{ event_id: string }>(
        `select event_id from events where slug = $1 for update`,
        [options.renameFrom],
      );
      if (existing.rows.length === 0) throw new Error("Event not found");
      const clash = await client.query<{ event_id: string }>(
        `select event_id from events where slug = $1`,
        [event.slug],
      );
      if (clash.rows.length > 0) throw new Error("Event slug already exists");
      await client.query(`update events set slug = $2, updated_at = now() where slug = $1`, [
        options.renameFrom,
        event.slug,
      ]);
    }

    await client.query(
      `insert into events (
         slug, title, tagline, status, starts_at, ends_at, doors_at, last_entry_at, timezone,
         area, venue_name, address, door_code, three_word_hint, map_url, step_free_access,
         transport_note, description, lineup, dress_code, age_limit, house_rules, hero_image,
         hero_image_width, hero_image_height, hero_height, og_image, marketing_path, capacity, waitlist_enabled, refund_policy,
         transferable, terms, check_in_opens_at, staff_notes, created_at, updated_at
       ) values (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22,
         $23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37
       )
       on conflict (slug) do update set
         title = excluded.title, tagline = excluded.tagline, status = excluded.status,
         starts_at = excluded.starts_at, ends_at = excluded.ends_at, doors_at = excluded.doors_at,
         last_entry_at = excluded.last_entry_at, timezone = excluded.timezone,
         area = excluded.area, venue_name = excluded.venue_name, address = excluded.address,
         door_code = excluded.door_code, three_word_hint = excluded.three_word_hint,
         map_url = excluded.map_url, step_free_access = excluded.step_free_access,
         transport_note = excluded.transport_note, description = excluded.description,
         lineup = excluded.lineup, dress_code = excluded.dress_code,
         age_limit = excluded.age_limit, house_rules = excluded.house_rules,
         hero_image = excluded.hero_image, hero_image_width = excluded.hero_image_width,
         hero_image_height = excluded.hero_image_height, hero_height = excluded.hero_height,
         og_image = excluded.og_image,
         marketing_path = excluded.marketing_path,
         capacity = excluded.capacity, waitlist_enabled = excluded.waitlist_enabled,
         refund_policy = excluded.refund_policy, transferable = excluded.transferable,
         terms = excluded.terms, check_in_opens_at = excluded.check_in_opens_at,
         staff_notes = excluded.staff_notes, updated_at = excluded.updated_at`,
      [
        event.slug,
        event.title,
        event.tagline ?? null,
        event.status,
        event.startsAt,
        event.endsAt ?? null,
        event.doorsAt ?? null,
        event.lastEntryAt ?? null,
        event.timezone,
        event.area ?? null,
        event.venueName ?? null,
        event.address ?? null,
        event.doorCode ?? null,
        event.threeWordHint ?? null,
        event.mapUrl ?? null,
        event.stepFreeAccess ?? null,
        event.transportNote ?? null,
        event.description ?? null,
        JSON.stringify(event.lineup ?? []),
        event.dressCode ?? null,
        event.ageLimit ?? null,
        event.houseRules ?? null,
        event.heroImage ?? null,
        event.heroImageWidth ?? null,
        event.heroImageHeight ?? null,
        event.heroHeight ?? null,
        event.ogImage ?? null,
        event.marketingPath ?? null,
        event.capacity ?? null,
        event.waitlistEnabled,
        event.refundPolicy ?? null,
        event.transferable,
        event.terms ?? null,
        event.checkInOpensAt ?? null,
        event.staffNotes ?? null,
        event.createdAt,
        event.updatedAt,
      ],
    );

    await replaceTicketTypes(client, event.slug, event.ticketTypes);
  });
}

/**
 * Delete an event.
 *
 * The foreign key from `tickets` is `on delete restrict`, so this fails
 * loudly rather than orphaning receipts people paid for.
 */
export async function deleteEvent(slug: string): Promise<void> {
  if (!isValidEventSlug(slug)) return;
  await query(`delete from events where slug = $1`, [slug]);
  log.info("events.delete", "Event deleted", { slug });
}

export async function eventHasTickets(slug: string): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    `select exists (select 1 from tickets where event_slug = $1) as exists`,
    [slug],
  );
  return rows[0]?.exists === true;
}
