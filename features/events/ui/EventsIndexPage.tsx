import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { SiteFooter, SiteFooterBar } from "@/components/SiteFooter";
import { SITE_BRAND } from "@/lib/shared/config";
import type {
  EventsIndexData,
  EventsIndexItem,
} from "@/features/event-operations/events-index.server";
import { formatEventDate, formatEventTime, formatMoney, type PublicEvent } from "../types";

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

function StatusPill({ event }: { event: EventsIndexItem }) {
  if (event.status === "published" && !event.soldOut) return null;
  const label =
    event.status === "cancelled"
      ? "cancelled"
      : event.status === "sold-out" || event.soldOut
        ? "sold out"
        : event.status;
  return (
    <span className="mt-0.5 inline-flex shrink-0 whitespace-nowrap rounded-full border theme-border px-3 py-1 font-mono text-micro uppercase tracking-widest theme-subtle">
      {label}
    </span>
  );
}

function EventRow({ event, past }: { event: EventsIndexItem; past?: boolean }) {
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
          <StatusPill event={event} />
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
  const [query, setQuery] = useState("");
  const { filteredUpcoming, filteredPast } = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return { filteredUpcoming: upcoming, filteredPast: past };
    const matches = (event: PublicEvent) => {
      const searchText = [
        event.title,
        event.tagline,
        event.area,
        event.description,
        ...event.lineup,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return tokens.every((token) => searchText.includes(token));
    };
    return {
      filteredUpcoming: upcoming.filter(matches),
      filteredPast: past.filter(matches),
    };
  }, [past, query, upcoming]);
  const resultCount = filteredUpcoming.length + filteredPast.length;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="max-w-2xl mx-auto px-6 pt-20 pb-10 text-center">
        <Link to="/" className="inline-flex min-h-11 min-w-11 items-center justify-center">
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

      <main id="main" className="max-w-2xl mx-auto flex-1 px-6 pt-4 pb-24">
        <div className="relative mb-8">
          <label htmlFor="events-search" className="sr-only">
            Search events
          </label>
          <input
            id="events-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="what are you looking for?"
            autoComplete="off"
            className="w-full bg-transparent py-3 pr-12 font-mono text-base sm:text-sm theme-muted outline-none border-b theme-border placeholder:theme-faint focus:border-[var(--foreground)]"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute inset-y-0 right-0 flex min-h-11 w-11 items-center justify-center font-mono text-lg theme-faint hover:text-foreground"
            >
              ×
            </button>
          ) : null}
          {query ? (
            <p className="mt-1.5 font-mono text-micro theme-faint" aria-live="polite">
              {resultCount === 0
                ? "no matches"
                : `${resultCount} event${resultCount === 1 ? "" : "s"}`}
            </p>
          ) : null}
        </div>
        <p className="font-mono text-micro theme-muted tracking-widest uppercase py-4">Upcoming</p>

        {filteredUpcoming.length === 0 ? (
          <p className="py-12 theme-muted font-mono text-sm text-center">
            {query
              ? "nothing here matches. try a different search."
              : "nothing announced yet. something's always cooking."}
          </p>
        ) : (
          <div>
            {filteredUpcoming.map((event) => (
              <EventRow key={event.slug} event={event} />
            ))}
          </div>
        )}

        {filteredPast.length > 0 && (
          <section className="mt-16">
            <p className="font-mono text-micro theme-muted tracking-widest uppercase py-4">
              Previously
            </p>
            <div>
              {filteredPast.slice(0, 10).map((event) => (
                <EventRow key={event.slug} event={event} past />
              ))}
            </div>
          </section>
        )}
      </main>

      <SiteFooter>
        <SiteFooterBar
          leading={
            <span className="whitespace-nowrap">
              © {new Date().getFullYear()} {SITE_BRAND}
            </span>
          }
          trailing={
            <nav
              aria-label="Footer"
              className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 md:justify-end"
            >
              <Link to="/privacy" className="hover:text-foreground transition-colors">
                privacy
              </Link>
              <Link to="/contact" className="hover:text-foreground transition-colors">
                contact
              </Link>
              <Link to="/" className="hover:text-foreground transition-colors">
                ← home
              </Link>
            </nav>
          }
        />
      </SiteFooter>
    </div>
  );
}
