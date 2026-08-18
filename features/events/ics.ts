import { formatEventDateTime, threeWordMapUrl, type EventRecord } from "./types";

/**
 * Minimal RFC 5545 calendar generation.
 *
 * Deliberately dependency-free and pure: an `.ics` file is a handful of
 * folded text lines, and the alternative is a library for something we can
 * fully test in twenty lines.
 */

/** RFC 5545 escaping — order matters, backslash first. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Lines must not exceed 75 octets; continuations start with a single space. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    chunks.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest.length > 0) chunks.push(` ${rest}`);
  return chunks.join("\r\n");
}

function toIcsInstant(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

export type IcsOptions = {
  /** The link the entry points at, and the last line of its description. */
  url: string;
  /** Ticket holders get the real address; everyone else gets the public area. */
  location?: string;
  /** Extra description lines. Door code and hint belong to holders only. */
  details?: string[];
  /** Adds a display reminder this many minutes before the start. */
  alarmMinutesBefore?: number;
  /** Stable across regenerations so calendar clients update rather than duplicate. */
  uidDomain?: string;
};

export function buildEventIcs(event: EventRecord, options: IcsOptions): string {
  const domain = options.uidDomain ?? "milkandhenny.com";
  const start = toIcsInstant(event.startsAt);

  // Default to a three-hour block when no end is set, so the entry does not
  // render as an all-day event in most calendar clients.
  const endSource =
    event.endsAt ?? new Date(Date.parse(event.startsAt) + 3 * 60 * 60 * 1000).toISOString();
  const end = toIcsInstant(endSource);

  // Prose blocks are separated by a blank line; the practical detail is a
  // tight list, because a calendar preview only shows the first few lines.
  const detailBlock = (options.details ?? []).filter((line) => line.trim()).join("\n");

  const descriptionParts = [
    event.tagline,
    event.description,
    detailBlock || null,
    // A holder entry labels its own links inside `details`.
    options.details ? null : options.url,
  ].filter((part): part is string => Boolean(part && part.trim()));

  // Apple, Google and Outlook all honour a DISPLAY alarm on import, which is
  // the only reminder a holder gets if they never open the email again.
  const alarm =
    options.alarmMinutesBefore && options.alarmMinutesBefore > 0
      ? [
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          `DESCRIPTION:${escapeText(event.title)}`,
          `TRIGGER:-PT${Math.round(options.alarmMinutesBefore)}M`,
          "END:VALARM",
        ]
      : [];

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${domain}//events//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.slug}@${domain}`,
    `DTSTAMP:${toIcsInstant(event.updatedAt) || start}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeText(event.title)}`,
    `DESCRIPTION:${escapeText(descriptionParts.join("\n\n"))}`,
    `URL:${escapeText(options.url)}`,
    options.location ? `LOCATION:${escapeText(options.location)}` : null,
    event.status === "cancelled" ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    ...alarm,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => line !== null);

  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/**
 * Two hours' notice: enough to leave the house, not so early it gets swiped
 * away and forgotten.
 */
const HOLDER_ALARM_MINUTES = 120;

/** The entry for someone who has not bought yet: area only, no reminder. */
export function buildPublicIcsOptions(event: EventRecord, eventUrl: string): IcsOptions {
  return {
    url: eventUrl,
    location: event.area ?? undefined,
  };
}

/**
 * The entry for someone holding a ticket.
 *
 * Everything they will want at 7pm on the night, in the one place they are
 * guaranteed to look: real address in LOCATION, door code and hint in the
 * description, and the entry itself pointing at the ticket so the QR is one
 * tap from the calendar.
 */
export function buildTicketHolderIcsOptions(
  event: EventRecord,
  options: { eventUrl: string; ticketUrl?: string },
): IcsOptions {
  const location = [event.venueName, event.address].filter(Boolean).join(", ");
  const threeWordUrl = threeWordMapUrl(event.threeWordHint);

  const details = [
    event.doorsAt ? `Doors ${formatEventDateTime(event.doorsAt, event.timezone)}` : null,
    event.lastEntryAt
      ? `Last entry ${formatEventDateTime(event.lastEntryAt, event.timezone)}`
      : null,
    event.doorCode ? `Venue door code: ${event.doorCode}` : null,
    event.threeWordHint
      ? `Find it: ${event.threeWordHint}${threeWordUrl ? ` — ${threeWordUrl}` : ""}`
      : null,
    event.transportNote ?? null,
    event.ageLimit ?? null,
    options.ticketUrl ? `Your ticket: ${options.ticketUrl}` : null,
    `Event page: ${options.eventUrl}`,
  ].filter((line): line is string => Boolean(line && line.trim()));

  return {
    // The ticket link when we have one: tapping the calendar entry should put
    // the QR on screen, not a marketing page.
    url: options.ticketUrl ?? options.eventUrl,
    location: location || event.area || undefined,
    details,
    alarmMinutesBefore: HOLDER_ALARM_MINUTES,
  };
}

/**
 * schema.org `Event` for search results and link previews.
 *
 * Only ever built from the public projection, so a private address cannot
 * leak into a `<script type="application/ld+json">` tag.
 */
export function buildEventJsonLd(
  event: Pick<
    EventRecord,
    | "title"
    | "startsAt"
    | "endsAt"
    | "status"
    | "description"
    | "area"
    | "heroImage"
    | "ticketTypes"
  >,
  options: { url: string; imageUrl?: string },
): Record<string, unknown> {
  const offers = event.ticketTypes
    .filter((type) => !type.hidden)
    .map((type) => ({
      "@type": "Offer",
      name: type.name,
      price: (type.priceMinor / 100).toFixed(2),
      priceCurrency: type.currency,
      url: options.url,
      availability:
        event.status === "sold-out" ? "https://schema.org/SoldOut" : "https://schema.org/InStock",
    }));

  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    startDate: event.startsAt,
    ...(event.endsAt ? { endDate: event.endsAt } : {}),
    eventStatus:
      event.status === "cancelled"
        ? "https://schema.org/EventCancelled"
        : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    ...(event.description ? { description: event.description } : {}),
    ...(options.imageUrl ? { image: [options.imageUrl] } : {}),
    location: {
      "@type": "Place",
      name: event.area ?? "London",
      address: { "@type": "PostalAddress", addressLocality: event.area ?? "London" },
    },
    url: options.url,
    ...(offers.length > 0 ? { offers } : {}),
  };
}
