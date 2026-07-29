/**
 * Event domain types and pure helpers.
 *
 * Safe to import from browser and server. Nothing here touches Redis,
 * `process.env`, or `node:crypto`.
 */

export const EVENT_STATUSES = ["draft", "published", "sold-out", "cancelled", "archived"] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

export function isEventStatus(value: unknown): value is EventStatus {
  return typeof value === "string" && (EVENT_STATUSES as readonly string[]).includes(value);
}

/**
 * A purchasable (or comp-able) class of admission.
 *
 * `priceMinor` is in the currency's minor unit (pence) so money never
 * touches a float. A zero price is a free ticket, not a missing price.
 */
export type TicketType = {
  id: string;
  name: string;
  description?: string;
  priceMinor: number;
  currency: string;
  quantity: number;
  perPersonLimit: number;
  salesStart?: string;
  salesEnd?: string;
  hidden: boolean;
};

export type EventRecord = {
  slug: string;
  title: string;
  tagline?: string;
  status: EventStatus;

  /** Instants are ISO-8601 UTC. `timezone` is the IANA zone the event happens in. */
  startsAt: string;
  endsAt?: string;
  doorsAt?: string;
  lastEntryAt?: string;
  timezone: string;

  /** Shown to everyone. */
  area?: string;
  /** Revealed only to ticket holders — see `toPublicEvent`. */
  venueName?: string;
  address?: string;
  doorCode?: string;
  threeWordHint?: string;
  mapUrl?: string;
  stepFreeAccess?: boolean;
  transportNote?: string;

  description?: string;
  lineup: string[];
  dressCode?: string;
  ageLimit?: string;
  houseRules?: string;

  heroImage?: string;
  ogImage?: string;
  /** Optional same-origin story page that leads into this event's checkout. */
  marketingPath?: string;

  ticketTypes: TicketType[];
  capacity?: number;
  waitlistEnabled: boolean;

  refundPolicy?: string;
  transferable: boolean;
  terms?: string;

  checkInOpensAt?: string;
  staffNotes?: string;

  createdAt: string;
  updatedAt: string;
};

/**
 * The projection safe to send to a browser that does not hold a ticket.
 *
 * Location detail is deliberately withheld: these events happen in a home,
 * so the exact address is earned by holding a ticket, not by loading a page.
 */
export type PublicEvent = Omit<
  EventRecord,
  "venueName" | "address" | "doorCode" | "threeWordHint" | "mapUrl" | "transportNote" | "staffNotes"
> & {
  locationRevealed: false;
};

/** The same event once the viewer holds a valid ticket. */
export type TicketHolderEvent = Omit<EventRecord, "staffNotes"> & {
  locationRevealed: true;
};

export type ViewableEvent = PublicEvent | TicketHolderEvent;

export const SAFE_EVENT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidEventSlug(slug: string): boolean {
  return SAFE_EVENT_SLUG.test(slug) && slug.length >= 2 && slug.length <= 80;
}

/** Lossy, deterministic slugification. Callers must still validate the result. */
export function slugifyEventTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/**
 * Strip the private fields. This is the only sanctioned way to turn a stored
 * event into something a browser may see.
 */
export function toPublicEvent(event: EventRecord): PublicEvent {
  const {
    venueName: _venueName,
    address: _address,
    doorCode: _doorCode,
    threeWordHint: _threeWordHint,
    mapUrl: _mapUrl,
    transportNote: _transportNote,
    staffNotes: _staffNotes,
    ...rest
  } = event;
  return { ...rest, locationRevealed: false };
}

export function toTicketHolderEvent(event: EventRecord): TicketHolderEvent {
  const { staffNotes: _staffNotes, ...rest } = event;
  return { ...rest, locationRevealed: true };
}

/** Publicly listable events. Drafts and archives never appear on the site. */
export function isPubliclyVisible(event: Pick<EventRecord, "status">): boolean {
  return (
    event.status === "published" || event.status === "sold-out" || event.status === "cancelled"
  );
}

export function isUpcoming(
  event: Pick<EventRecord, "startsAt" | "endsAt">,
  now = Date.now(),
): boolean {
  const end = event.endsAt ?? event.startsAt;
  const parsed = Date.parse(end);
  return Number.isFinite(parsed) ? parsed >= now : false;
}

export type SalesState =
  | { state: "on-sale" }
  | { state: "not-yet"; opensAt: string }
  | { state: "closed" }
  | { state: "sold-out" }
  | { state: "cancelled" }
  | { state: "none" };

/**
 * Whether a ticket type can be claimed right now.
 *
 * `sold` is passed in rather than read here so this stays pure and testable.
 */
export function ticketTypeSalesState(
  event: Pick<EventRecord, "status" | "startsAt" | "endsAt">,
  type: TicketType,
  sold: number,
  now = Date.now(),
): SalesState {
  if (event.status === "cancelled") return { state: "cancelled" };
  if (event.status === "sold-out") return { state: "sold-out" };
  if (!isUpcoming(event, now)) return { state: "closed" };
  if (type.salesStart) {
    const opens = Date.parse(type.salesStart);
    if (Number.isFinite(opens) && now < opens) {
      return { state: "not-yet", opensAt: type.salesStart };
    }
  }
  if (type.salesEnd) {
    const closes = Date.parse(type.salesEnd);
    if (Number.isFinite(closes) && now > closes) return { state: "closed" };
  }
  if (sold >= type.quantity) return { state: "sold-out" };
  return { state: "on-sale" };
}

export function isFreeEvent(event: Pick<EventRecord, "ticketTypes">): boolean {
  const visible = event.ticketTypes.filter((type) => !type.hidden);
  return visible.length > 0 && visible.every((type) => type.priceMinor === 0);
}

export function hasTickets(event: Pick<EventRecord, "ticketTypes">): boolean {
  return event.ticketTypes.some((type) => !type.hidden);
}

/** Minor units to a display string. Falls back to the ISO code for odd currencies. */
export function formatMoney(minor: number, currency: string): string {
  if (minor === 0) return "Free";
  const amount = minor / 100;
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** e.g. "Sat 12 Sep, 8:00 pm" in the event's own timezone. */
export function formatEventDateTime(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function formatEventDate(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: timezone,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function formatEventTime(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}
