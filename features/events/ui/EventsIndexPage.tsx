import { Link } from "@tanstack/react-router";

import { SITE_BRAND } from "@/lib/shared/config";
import { formatEventDate, formatEventTime, formatMoney, type PublicEvent } from "../types";
import type { EventsIndexData } from "../events.server";

/**
 * The events index.
 *
 * A chronological list rather than a month grid: at roughly one event a
 * month a calendar is mostly empty squares, and it collapses badly on the
 * phone that most people will open this on.
 */

function dateParts(event: PublicEvent): { day: string; month: string } {
  const date = new Date(event.startsAt);
  if (Number.isNaN(date.getTime())) return { day: "—", month: "" };
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: event.timezone,
    });
    const parts = formatter.formatToParts(date);
    return {
      day: parts.find((part) => part.type === "day")?.value ?? "—",
      month: (parts.find((part) => part.type === "month")?.value ?? "").toLowerCase(),
    };
  } catch {
    return { day: "—", month: "" };
  }
}

function priceLabel(event: PublicEvent): string | null {
  const visible = event.ticketTypes.filter((type) => !type.hidden);
  if (visible.length === 0) return null;
  const cheapest = visible.reduce((min, type) => (type.priceMinor < min.priceMinor ? type : min));
  if (cheapest.priceMinor === 0) return "free";
  const formatted = formatMoney(cheapest.priceMinor, cheapest.currency);
  return visible.length > 1 ? `from ${formatted}` : formatted;
}

function StatusPill({ status }: { status: PublicEvent["status"] }) {
  if (status === "published") return null;
  const label = status === "sold-out" ? "sold out" : status === "cancelled" ? "cancelled" : status;
  return (
    <span className="font-mono text-micro tracking-widest uppercase theme-subtle border theme-border rounded-full px-2 py-0.5">
      {label}
    </span>
  );
}

function EventRow({ event, past }: { event: PublicEvent; past?: boolean }) {
  const { day, month } = dateParts(event);
  const price = priceLabel(event);

  return (
    <Link
      to="/events/$slug"
      params={{ slug: event.slug }}
      className={`group flex gap-5 py-6 border-b theme-border transition-opacity ${
        past ? "opacity-60 hover:opacity-90" : "hover:opacity-70"
      }`}
    >
      <div className="shrink-0 w-12 text-center" aria-hidden="true">
        <div className="font-mono text-2xl font-bold text-foreground leading-none">{day}</div>
        <div className="font-mono text-micro theme-muted tracking-widest uppercase mt-1">
          {month}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-serif text-lg text-foreground leading-snug">{event.title}</h3>
          <StatusPill status={event.status} />
        </div>

        {event.tagline && (
          <p className="mt-1 font-serif text-sm theme-subtle leading-relaxed">{event.tagline}</p>
        )}

        <p className="mt-2 font-mono text-micro theme-muted tracking-wide">
          <span className="sr-only">Date: </span>
          {formatEventDate(event.startsAt, event.timezone)}
          {" · "}
          {formatEventTime(event.doorsAt ?? event.startsAt, event.timezone)}
          {event.area ? ` · ${event.area}` : ""}
          {price ? ` · ${price}` : ""}
        </p>
      </div>
    </Link>
  );
}

export function EventsIndexPage({ upcoming, past }: EventsIndexData) {
  return (
    <div className="min-h-screen bg-background">
      <header className="max-w-2xl mx-auto px-6 pt-20 pb-10 text-center">
        <Link to="/" className="inline-block">
          <h1 className="font-mono text-3xl sm:text-4xl font-bold text-foreground tracking-tighter leading-none">
            {SITE_BRAND}
          </h1>
        </Link>
        <p className="mt-4 font-mono text-sm theme-muted tracking-wide">events</p>
        <p className="mt-2 font-serif italic text-sm theme-faint">
          nights worth leaving the house for
        </p>
      </header>

      <div className="max-w-2xl mx-auto px-6">
        <div className="border-t theme-border-strong" />
      </div>

      <main id="main" className="max-w-2xl mx-auto px-6 pt-4 pb-24">
        <p className="font-mono text-micro theme-muted tracking-widest uppercase py-4">Upcoming</p>

        {upcoming.length === 0 ? (
          <p className="py-12 theme-muted font-mono text-sm text-center">
            nothing announced yet. something&apos;s always cooking.
          </p>
        ) : (
          <div>
            {upcoming.map((event) => (
              <EventRow key={event.slug} event={event} />
            ))}
          </div>
        )}

        {past.length > 0 && (
          <section className="mt-16">
            <p className="font-mono text-micro theme-muted tracking-widest uppercase py-4">
              Previously
            </p>
            <div>
              {past.slice(0, 10).map((event) => (
                <EventRow key={event.slug} event={event} past />
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="border-t theme-border">
        <div className="max-w-2xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between font-mono text-micro theme-muted tracking-wide">
            <span>
              © {new Date().getFullYear()} {SITE_BRAND}
            </span>
            <Link to="/" className="hover:text-foreground transition-colors">
              ← home
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
