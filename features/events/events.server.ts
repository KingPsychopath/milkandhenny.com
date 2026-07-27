import { getRedis } from "@/lib/platform/redis.server";
import { log } from "@/lib/platform/logger.server";
import { ticketTypeSoldKey } from "./config.server";
import { deleteEvent, getEvent, listEvents, putEvent } from "./store.server";
import {
  isEventStatus,
  isPubliclyVisible,
  isUpcoming,
  isValidEventSlug,
  slugifyEventTitle,
  ticketTypeSalesState,
  toPublicEvent,
  toTicketHolderEvent,
  type EventRecord,
  type EventStatus,
  type PublicEvent,
  type SalesState,
  type TicketType,
  type ViewableEvent,
} from "./types";

/**
 * Event workflows and durable product rules.
 *
 * Routes own transport and coarse auth; this module owns what an event is
 * allowed to be. Nothing here returns a thrown error across a boundary —
 * callers get a typed result, matching the convention used elsewhere in
 * `features/*`.
 */

export type EventOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

const MAX_TITLE = 140;
const MAX_TAGLINE = 200;
const MAX_TEXT = 8000;
const MAX_SHORT_TEXT = 500;
const MAX_TICKET_TYPES = 10;
const MAX_LINEUP = 40;

function trimmed(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  if (!clean) return undefined;
  return clean.slice(0, max);
}

function isValidInstant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** Reject anything `Intl` cannot resolve, so stored events always render. */
function isValidTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    // `format()` rather than a bare construction: it forces the zone to
    // actually resolve, and keeps this from reading as a side-effecting `new`.
    return new Intl.DateTimeFormat("en-GB", { timeZone: value }).format(0).length > 0;
  } catch {
    return false;
  }
}

function normaliseInstant(value: unknown): string | undefined {
  if (!isValidInstant(value)) return undefined;
  return new Date(value).toISOString();
}

function normaliseTicketType(input: unknown, index: number): EventOpResult<TicketType> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: 400, error: `Ticket type ${index + 1} is malformed` };
  }
  const raw = input as Record<string, unknown>;

  const name = trimmed(raw.name, 80);
  if (!name) return { ok: false, status: 400, error: `Ticket type ${index + 1} needs a name` };

  const priceMinor =
    typeof raw.priceMinor === "number" && Number.isFinite(raw.priceMinor)
      ? Math.max(0, Math.round(raw.priceMinor))
      : 0;

  const quantity =
    typeof raw.quantity === "number" && Number.isFinite(raw.quantity)
      ? Math.max(0, Math.round(raw.quantity))
      : 0;

  const perPersonLimit =
    typeof raw.perPersonLimit === "number" && Number.isFinite(raw.perPersonLimit)
      ? Math.min(Math.max(1, Math.round(raw.perPersonLimit)), 20)
      : 4;

  const currency = trimmed(raw.currency, 3)?.toUpperCase() ?? "GBP";
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, status: 400, error: `Ticket type "${name}" has an invalid currency` };
  }

  const salesStart = normaliseInstant(raw.salesStart);
  const salesEnd = normaliseInstant(raw.salesEnd);
  if (salesStart && salesEnd && Date.parse(salesEnd) <= Date.parse(salesStart)) {
    return { ok: false, status: 400, error: `Ticket type "${name}" closes before it opens` };
  }

  const id = trimmed(raw.id, 40) ?? `tt_${index + 1}`;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return { ok: false, status: 400, error: `Ticket type "${name}" has an invalid id` };
  }

  return {
    ok: true,
    value: {
      id,
      name,
      description: trimmed(raw.description, MAX_SHORT_TEXT),
      priceMinor,
      currency,
      quantity,
      perPersonLimit,
      salesStart,
      salesEnd,
      hidden: raw.hidden === true,
    },
  };
}

export type EventInput = Record<string, unknown>;

/**
 * Validate and normalise caller-supplied event fields.
 *
 * `existing` is supplied on update so unspecified fields are preserved and
 * `createdAt` is never rewritten.
 */
export function normaliseEventInput(
  input: EventInput,
  existing?: EventRecord,
): EventOpResult<EventRecord> {
  const title = trimmed(input.title, MAX_TITLE) ?? existing?.title;
  if (!title) return { ok: false, status: 400, error: "Title is required" };

  const slugSource = trimmed(input.slug, 80) ?? existing?.slug ?? slugifyEventTitle(title);
  const slug = slugifyEventTitle(slugSource);
  if (!isValidEventSlug(slug)) {
    return {
      ok: false,
      status: 400,
      error: "Slug must be 2–80 lowercase letters, numbers or dashes",
    };
  }

  const startsAt = normaliseInstant(input.startsAt) ?? existing?.startsAt;
  if (!startsAt) return { ok: false, status: 400, error: "A valid start time is required" };

  const endsAt = normaliseInstant(input.endsAt) ?? existing?.endsAt;
  if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    return { ok: false, status: 400, error: "End time must be after the start time" };
  }

  const doorsAt = normaliseInstant(input.doorsAt) ?? existing?.doorsAt;
  if (doorsAt && Date.parse(doorsAt) > Date.parse(startsAt)) {
    return { ok: false, status: 400, error: "Doors must open no later than the start time" };
  }

  const lastEntryAt = normaliseInstant(input.lastEntryAt) ?? existing?.lastEntryAt;
  if (lastEntryAt && Date.parse(lastEntryAt) < Date.parse(startsAt)) {
    return { ok: false, status: 400, error: "Last entry cannot be before the start time" };
  }

  const timezoneInput = input.timezone ?? existing?.timezone ?? "Europe/London";
  if (!isValidTimezone(timezoneInput)) {
    return { ok: false, status: 400, error: "Timezone must be a valid IANA zone" };
  }

  const status: EventStatus = isEventStatus(input.status)
    ? input.status
    : (existing?.status ?? "draft");

  const rawTicketTypes = Array.isArray(input.ticketTypes)
    ? input.ticketTypes
    : (existing?.ticketTypes ?? []);
  if (rawTicketTypes.length > MAX_TICKET_TYPES) {
    return { ok: false, status: 400, error: `At most ${MAX_TICKET_TYPES} ticket types` };
  }

  const ticketTypes: TicketType[] = [];
  const seenTypeIds = new Set<string>();
  for (const [index, raw] of rawTicketTypes.entries()) {
    const result = normaliseTicketType(raw, index);
    if (!result.ok) return result;
    if (seenTypeIds.has(result.value.id)) {
      return { ok: false, status: 400, error: `Duplicate ticket type id "${result.value.id}"` };
    }
    seenTypeIds.add(result.value.id);
    ticketTypes.push(result.value);
  }

  const lineup = Array.isArray(input.lineup)
    ? input.lineup
        .map((entry) => trimmed(entry, 80))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, MAX_LINEUP)
    : (existing?.lineup ?? []);

  const capacityInput = input.capacity ?? existing?.capacity;
  const capacity =
    typeof capacityInput === "number" && Number.isFinite(capacityInput) && capacityInput > 0
      ? Math.round(capacityInput)
      : undefined;

  // Publishing is the point at which an event becomes a promise to a stranger.
  if (isPubliclyVisible({ status }) && status !== "cancelled") {
    if (ticketTypes.length === 0) {
      return { ok: false, status: 400, error: "Add at least one ticket type before publishing" };
    }
    if (!trimmed(input.area, 120) && !existing?.area) {
      return {
        ok: false,
        status: 400,
        error: "A public area (e.g. “East London”) is required before publishing",
      };
    }
  }

  const now = new Date().toISOString();

  return {
    ok: true,
    value: {
      slug,
      title,
      tagline: trimmed(input.tagline, MAX_TAGLINE) ?? existing?.tagline,
      status,
      startsAt,
      endsAt,
      doorsAt,
      lastEntryAt,
      timezone: timezoneInput,
      area: trimmed(input.area, 120) ?? existing?.area,
      venueName: trimmed(input.venueName, 140) ?? existing?.venueName,
      address: trimmed(input.address, MAX_SHORT_TEXT) ?? existing?.address,
      doorCode: trimmed(input.doorCode, 60) ?? existing?.doorCode,
      threeWordHint: trimmed(input.threeWordHint, 80) ?? existing?.threeWordHint,
      mapUrl: trimmed(input.mapUrl, 500) ?? existing?.mapUrl,
      stepFreeAccess:
        typeof input.stepFreeAccess === "boolean" ? input.stepFreeAccess : existing?.stepFreeAccess,
      transportNote: trimmed(input.transportNote, MAX_SHORT_TEXT) ?? existing?.transportNote,
      description: trimmed(input.description, MAX_TEXT) ?? existing?.description,
      lineup,
      dressCode: trimmed(input.dressCode, 140) ?? existing?.dressCode,
      ageLimit: trimmed(input.ageLimit, 60) ?? existing?.ageLimit,
      houseRules: trimmed(input.houseRules, MAX_TEXT) ?? existing?.houseRules,
      heroImage: trimmed(input.heroImage, 500) ?? existing?.heroImage,
      ogImage: trimmed(input.ogImage, 500) ?? existing?.ogImage,
      ticketTypes,
      capacity,
      waitlistEnabled:
        typeof input.waitlistEnabled === "boolean"
          ? input.waitlistEnabled
          : (existing?.waitlistEnabled ?? false),
      refundPolicy: trimmed(input.refundPolicy, MAX_TEXT) ?? existing?.refundPolicy,
      transferable:
        typeof input.transferable === "boolean"
          ? input.transferable
          : (existing?.transferable ?? false),
      terms: trimmed(input.terms, MAX_TEXT) ?? existing?.terms,
      checkInOpensAt: normaliseInstant(input.checkInOpensAt) ?? existing?.checkInOpensAt,
      staffNotes: trimmed(input.staffNotes, MAX_TEXT) ?? existing?.staffNotes,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    },
  };
}

export async function createEvent(input: EventInput): Promise<EventOpResult<EventRecord>> {
  const normalised = normaliseEventInput(input);
  if (!normalised.ok) return normalised;

  const clash = await getEvent(normalised.value.slug);
  if (clash) {
    return {
      ok: false,
      status: 409,
      error: `An event with slug "${normalised.value.slug}" exists`,
    };
  }

  await putEvent(normalised.value);
  log.info("events.create", "Event created", { slug: normalised.value.slug });
  return { ok: true, value: normalised.value };
}

export async function updateEvent(
  slug: string,
  input: EventInput,
): Promise<EventOpResult<EventRecord>> {
  const existing = await getEvent(slug);
  if (!existing) return { ok: false, status: 404, error: "Event not found" };

  const normalised = normaliseEventInput(input, existing);
  if (!normalised.ok) return normalised;

  // A slug change is a move: write the new record, then drop the old key.
  if (normalised.value.slug !== existing.slug) {
    const clash = await getEvent(normalised.value.slug);
    if (clash) {
      return {
        ok: false,
        status: 409,
        error: `An event with slug "${normalised.value.slug}" exists`,
      };
    }
    await putEvent(normalised.value);
    await deleteEvent(existing.slug);
    log.info("events.update", "Event slug changed", {
      from: existing.slug,
      to: normalised.value.slug,
    });
    return { ok: true, value: normalised.value };
  }

  await putEvent(normalised.value);
  return { ok: true, value: normalised.value };
}

export async function removeEvent(slug: string): Promise<EventOpResult<void>> {
  const existing = await getEvent(slug);
  if (!existing) return { ok: false, status: 404, error: "Event not found" };
  await deleteEvent(slug);
  return { ok: true, value: undefined };
}

/** Sold counts per ticket type, read as one hash rather than by scanning tickets. */
export async function getSoldCounts(slug: string): Promise<Record<string, number>> {
  const redis = getRedis();
  if (!redis) return {};
  try {
    const raw = await redis.hgetall<Record<string, string | number>>(ticketTypeSoldKey(slug));
    const counts: Record<string, number> = {};
    for (const [id, value] of Object.entries(raw ?? {})) {
      const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) counts[id] = parsed;
    }
    return counts;
  } catch (error) {
    log.error("events.sold", "Failed to read sold counts", { slug }, error);
    return {};
  }
}

export type TicketTypeAvailability = {
  type: TicketType;
  sold: number;
  remaining: number;
  sales: SalesState;
};

export function buildAvailability(
  event: EventRecord,
  sold: Record<string, number>,
  now = Date.now(),
): TicketTypeAvailability[] {
  return event.ticketTypes
    .filter((type) => !type.hidden)
    .map((type) => {
      const soldCount = sold[type.id] ?? 0;
      return {
        type,
        sold: soldCount,
        remaining: Math.max(0, type.quantity - soldCount),
        sales: ticketTypeSalesState(event, type, soldCount, now),
      };
    });
}

export type EventPageData = {
  event: ViewableEvent;
  availability: TicketTypeAvailability[];
};

/**
 * The public event page payload.
 *
 * `revealLocation` is decided by the caller after checking ticket ownership;
 * this function never infers it.
 */
export async function getEventPage(
  slug: string,
  options: { revealLocation?: boolean; includeHidden?: boolean } = {},
): Promise<EventPageData | null> {
  const event = await getEvent(slug);
  if (!event) return null;
  if (!options.includeHidden && !isPubliclyVisible(event)) return null;

  const sold = await getSoldCounts(slug);
  return {
    event: options.revealLocation ? toTicketHolderEvent(event) : toPublicEvent(event),
    availability: buildAvailability(event, sold),
  };
}

export type EventsIndexData = {
  upcoming: PublicEvent[];
  past: PublicEvent[];
};

/** Upcoming ascending (soonest first), past descending (most recent first). */
export async function getEventsIndex(now = Date.now()): Promise<EventsIndexData> {
  const events = await listEvents();
  const upcoming: PublicEvent[] = [];
  const past: PublicEvent[] = [];

  for (const event of events) {
    (isUpcoming(event, now) ? upcoming : past).push(toPublicEvent(event));
  }

  upcoming.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  past.sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));

  return { upcoming, past };
}

export { getEvent, listEvents };
