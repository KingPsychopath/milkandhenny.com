import { log } from "@/lib/platform/logger.server";
import { deleteEvent, getEvent, listEvents, putEvent } from "./store.server";
import {
  isEventArrivalExperience,
  isEventHeroHeight,
  isEventStatus,
  isPubliclyVisible,
  isValidEventSlug,
  slugifyEventTitle,
  type EventRecord,
  type EventStatus,
  type TicketType,
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

function hasOwn(input: EventInput, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

/** Omission preserves a PATCH field; an explicit null or blank clears it. */
function optionalText(
  input: EventInput,
  key: string,
  max: number,
  existing: string | undefined,
): string | undefined {
  return hasOwn(input, key) ? trimmed(input[key], max) : existing;
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

function optionalInstant(
  input: EventInput,
  key: string,
  existing: string | undefined,
): string | undefined {
  return hasOwn(input, key) ? normaliseInstant(input[key]) : existing;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
}

function marketingPath(value: unknown): string | undefined {
  const path = trimmed(value, 200);
  return path && path.startsWith("/") && !path.startsWith("//") && !path.includes("\\")
    ? path
    : undefined;
}

function externalHttpUrl(value: unknown): string | undefined {
  const candidate = trimmed(value, 500);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function normaliseTicketType(input: unknown, index: number): EventOpResult<TicketType> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: 400, error: `Ticket type ${index + 1} is malformed` };
  }
  const raw = input as Record<string, unknown>;

  const name = trimmed(raw.name, 80);
  if (!name) return { ok: false, status: 400, error: `Ticket type ${index + 1} needs a name` };

  if (typeof raw.priceMinor === "number" && Number.isFinite(raw.priceMinor) && raw.priceMinor < 0) {
    return { ok: false, status: 400, error: `Ticket type "${name}" cannot have a negative price` };
  }
  const priceMinor =
    typeof raw.priceMinor === "number" && Number.isFinite(raw.priceMinor)
      ? Math.round(raw.priceMinor)
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

function eventCommitmentConflict(error: unknown): EventOpResult<never> | null {
  if (!error || typeof error !== "object") return null;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  if (code === "23514" && message.includes("committed places")) {
    return { ok: false, status: 409, error: message };
  }
  if (code === "23503") {
    return {
      ok: false,
      status: 409,
      error:
        "That ticket type has ticket or exchange history and cannot be removed. Hide it instead.",
    };
  }
  return null;
}

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
  if (
    typeof input.marketingPath === "string" &&
    input.marketingPath.trim() &&
    !marketingPath(input.marketingPath)
  ) {
    return {
      ok: false,
      status: 400,
      error: "Marketing story path must be a local path beginning with /",
    };
  }
  if (typeof input.mapUrl === "string" && input.mapUrl.trim() && !externalHttpUrl(input.mapUrl)) {
    return { ok: false, status: 400, error: "Map link must be an http or https URL" };
  }

  const startsAt = optionalInstant(input, "startsAt", existing?.startsAt);
  if (!startsAt) return { ok: false, status: 400, error: "A valid start time is required" };

  const endsAt = optionalInstant(input, "endsAt", existing?.endsAt);
  if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    return { ok: false, status: 400, error: "End time must be after the start time" };
  }

  const doorsAt = optionalInstant(input, "doorsAt", existing?.doorsAt);
  if (doorsAt && Date.parse(doorsAt) > Date.parse(startsAt)) {
    return { ok: false, status: 400, error: "Doors must open no later than the start time" };
  }

  const lastEntryAt = optionalInstant(input, "lastEntryAt", existing?.lastEntryAt);
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
  if (existing?.status === "cancelled" && status !== "cancelled") {
    return { ok: false, status: 409, error: "A cancelled event cannot be reopened" };
  }

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

  const capacityInput = hasOwn(input, "capacity") ? input.capacity : existing?.capacity;
  const capacity =
    typeof capacityInput === "number" && Number.isFinite(capacityInput) && capacityInput > 0
      ? Math.round(capacityInput)
      : undefined;

  // Publishing is the point at which an event becomes a promise to a stranger.
  if (isPubliclyVisible({ status }) && status !== "cancelled") {
    if (ticketTypes.length === 0) {
      return { ok: false, status: 400, error: "Add at least one ticket type before publishing" };
    }
    const area = optionalText(input, "area", 120, existing?.area);
    if (!area) {
      return {
        ok: false,
        status: 400,
        error: "A public area (e.g. “East London”) is required before publishing",
      };
    }
  }

  const now = new Date().toISOString();
  const heroImage = optionalText(input, "heroImage", 500, existing?.heroImage);
  const mapUrl = hasOwn(input, "mapUrl") ? externalHttpUrl(input.mapUrl) : existing?.mapUrl;
  const keepHeroDimensions = heroImage === existing?.heroImage;

  return {
    ok: true,
    value: {
      slug,
      title,
      tagline: optionalText(input, "tagline", MAX_TAGLINE, existing?.tagline),
      status,
      startsAt,
      endsAt,
      doorsAt,
      lastEntryAt,
      timezone: timezoneInput,
      area: optionalText(input, "area", 120, existing?.area),
      venueName: optionalText(input, "venueName", 140, existing?.venueName),
      address: optionalText(input, "address", MAX_SHORT_TEXT, existing?.address),
      doorCode: optionalText(input, "doorCode", 60, existing?.doorCode),
      threeWordHint: optionalText(input, "threeWordHint", 80, existing?.threeWordHint),
      mapUrl,
      stepFreeAccess:
        typeof input.stepFreeAccess === "boolean" ? input.stepFreeAccess : existing?.stepFreeAccess,
      transportNote: optionalText(input, "transportNote", MAX_SHORT_TEXT, existing?.transportNote),
      description: optionalText(input, "description", MAX_TEXT, existing?.description),
      lineup,
      dressCode: optionalText(input, "dressCode", 140, existing?.dressCode),
      ageLimit: optionalText(input, "ageLimit", 60, existing?.ageLimit),
      houseRules: optionalText(input, "houseRules", MAX_TEXT, existing?.houseRules),
      heroImage,
      heroImageWidth:
        positiveInteger(input.heroImageWidth) ??
        (keepHeroDimensions ? existing?.heroImageWidth : undefined),
      heroImageHeight:
        positiveInteger(input.heroImageHeight) ??
        (keepHeroDimensions ? existing?.heroImageHeight : undefined),
      heroHeight: isEventHeroHeight(input.heroHeight) ? input.heroHeight : existing?.heroHeight,
      ogImage: optionalText(input, "ogImage", 500, existing?.ogImage),
      marketingPath: hasOwn(input, "marketingPath")
        ? marketingPath(input.marketingPath)
        : existing?.marketingPath,
      ticketTypes,
      capacity,
      waitlistEnabled:
        typeof input.waitlistEnabled === "boolean"
          ? input.waitlistEnabled
          : (existing?.waitlistEnabled ?? true),
      refundPolicy: optionalText(input, "refundPolicy", MAX_TEXT, existing?.refundPolicy),
      transferable:
        typeof input.transferable === "boolean"
          ? input.transferable
          : (existing?.transferable ?? false),
      terms: optionalText(input, "terms", MAX_TEXT, existing?.terms),
      checkInOpensAt: optionalInstant(input, "checkInOpensAt", existing?.checkInOpensAt),
      arrivalExperience: isEventArrivalExperience(input.arrivalExperience)
        ? input.arrivalExperience
        : (existing?.arrivalExperience ?? "none"),
      staffNotes: optionalText(input, "staffNotes", MAX_TEXT, existing?.staffNotes),
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
  const created = await getEvent(normalised.value.slug);
  return created
    ? { ok: true, value: created }
    : { ok: false, status: 500, error: "Event could not be read after creation" };
}

export async function updateEvent(
  slug: string,
  input: EventInput,
): Promise<EventOpResult<EventRecord>> {
  const existing = await getEvent(slug);
  if (!existing) return { ok: false, status: 404, error: "Event not found" };

  const normalised = normaliseEventInput(input, existing);
  if (!normalised.ok) return normalised;

  // A slug change updates the route label in one transaction. The immutable
  // event_id remains attached to every scoring and identity record.
  if (normalised.value.slug !== existing.slug) {
    const clash = await getEvent(normalised.value.slug);
    if (clash) {
      return {
        ok: false,
        status: 409,
        error: `An event with slug "${normalised.value.slug}" exists`,
      };
    }
    try {
      await putEvent(normalised.value, { renameFrom: existing.slug });
    } catch (error) {
      const conflict = eventCommitmentConflict(error);
      if (conflict) return conflict;
      throw error;
    }
    log.info("events.update", "Event slug changed", {
      from: existing.slug,
      to: normalised.value.slug,
    });
    const updated = await getEvent(normalised.value.slug);
    return updated
      ? { ok: true, value: updated }
      : { ok: false, status: 500, error: "Event could not be read after rename" };
  }

  try {
    await putEvent(normalised.value);
  } catch (error) {
    const conflict = eventCommitmentConflict(error);
    if (conflict) return conflict;
    throw error;
  }
  const updated = await getEvent(normalised.value.slug);
  return updated
    ? { ok: true, value: updated }
    : { ok: false, status: 500, error: "Event could not be read after update" };
}

export async function removeEvent(slug: string): Promise<EventOpResult<void>> {
  const existing = await getEvent(slug);
  if (!existing) return { ok: false, status: 404, error: "Event not found" };
  await deleteEvent(slug);
  return { ok: true, value: undefined };
}

export { getEvent, listEvents };
