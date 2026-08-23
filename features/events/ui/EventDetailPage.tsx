import { Link } from "@tanstack/react-router";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { SITE_BRAND } from "@/lib/shared/config";
import type { PublicPitchDeck } from "@/features/things/pitches/types";
import { eventIcsPath } from "../routes";
import {
  formatEventDate,
  formatEventTime,
  hasTickets,
  heroImageHeightClass,
  type TicketHolderEvent,
  type ViewableEvent,
} from "../types";
import { AppImage } from "@/components/AppImage";
import type { TicketTypeAvailability } from "../events.server";
import { AddressLink } from "./AddressLink";
import { ThreeWordHint } from "./ThreeWordHint";
import { ClaimTicketForm } from "./ClaimTicketForm";
import { ResendTicketForm } from "./ResendTicketForm";
import { EventDescription } from "./EventDescription";

const POLICY_MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p>{children}</p>,
  ul: ({ children }) => <ul className="list-disc space-y-2 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-2 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
};

/**
 * The event page.
 *
 * Ordering is deliberate: what and when, then how to get in, then
 * everything else. Someone deciding on a phone should be able to answer
 * "am I going?" and act on it without scrolling past a wall of prose.
 */

function isRevealed(event: ViewableEvent): event is TicketHolderEvent {
  return event.locationRevealed;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 py-2">
      <dt className="shrink-0 w-20 font-mono text-micro theme-muted tracking-widest uppercase pt-0.5">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 font-serif text-sm text-foreground leading-relaxed">
        {children}
      </dd>
    </div>
  );
}

function StatusBanner({ status }: { status: ViewableEvent["status"] }) {
  if (status === "published") return null;

  const copy =
    status === "cancelled"
      ? "This event has been cancelled."
      : status === "sold-out"
        ? "This event is sold out."
        : status === "draft"
          ? "Draft — only you can see this."
          : "This event is archived.";

  return (
    <p className="mb-6 px-4 py-3 border theme-border-strong rounded-lg font-mono text-xs text-foreground">
      {copy}
    </p>
  );
}

function PolicyMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={POLICY_MARKDOWN_COMPONENTS}>
      {children}
    </ReactMarkdown>
  );
}

export function EventDetailPage({
  event,
  availability,
  pitchShowcase,
  checkoutCancelled = false,
}: {
  event: ViewableEvent;
  availability: TicketTypeAvailability[];
  pitchShowcase?: PublicPitchDeck[];
  /** Set when Stripe sent them back without taking payment. */
  checkoutCancelled?: boolean;
}) {
  const revealed = isRevealed(event);
  const ticketsExist = hasTickets(event);
  const doorsAt = event.doorsAt;
  const doorsDifferFromStart =
    doorsAt && new Date(doorsAt).getTime() !== new Date(event.startsAt).getTime();

  return (
    <div className="min-h-screen bg-background">
      <header className="max-w-2xl mx-auto px-6 pt-12 pb-6">
        <Link
          to="/events"
          className="font-mono text-micro theme-muted tracking-wide hover:text-foreground transition-colors"
        >
          ← {SITE_BRAND} events
        </Link>
      </header>

      <main id="main" className="max-w-2xl mx-auto px-6 pb-24">
        <StatusBanner status={event.status} />

        {checkoutCancelled && (
          <p className="mb-6 px-4 py-3 border theme-border rounded-lg font-mono text-xs theme-subtle">
            Checkout was cancelled — you haven&apos;t been charged, and no tickets were issued.
          </p>
        )}

        {event.marketingPath ? (
          <a
            href={event.marketingPath}
            className="mb-6 inline-flex min-h-10 items-center border-b theme-border-strong font-mono text-xs text-foreground hover:opacity-60"
          >
            enter the full story →
          </a>
        ) : null}

        {event.heroImage && (
          <AppImage
            src={event.heroImage}
            alt=""
            width={event.heroImageWidth}
            height={event.heroImageHeight}
            className={`mb-8 h-auto w-full rounded-lg bg-surface ${heroImageHeightClass(event.heroHeight)}`}
            priority
          />
        )}

        <h1 className="font-serif text-3xl sm:text-4xl text-foreground leading-tight">
          {event.title}
        </h1>
        {event.tagline && (
          <p className="mt-3 font-serif text-lg theme-subtle leading-relaxed">{event.tagline}</p>
        )}

        {/* Key facts — everything needed to decide, above the fold. */}
        <dl className="mt-8 divide-y theme-border border-y theme-border py-2">
          <Fact label="When">
            {formatEventDate(event.startsAt, event.timezone)}
            <br />
            <span className="theme-subtle">
              {doorsDifferFromStart ? `Doors ${formatEventTime(doorsAt, event.timezone)} · ` : ""}
              {formatEventTime(event.startsAt, event.timezone)}
              {event.endsAt ? ` – ${formatEventTime(event.endsAt, event.timezone)}` : ""}
            </span>
            {event.lastEntryAt && (
              <>
                <br />
                <span className="theme-muted font-mono text-micro">
                  last entry {formatEventTime(event.lastEntryAt, event.timezone)}
                </span>
              </>
            )}
          </Fact>

          <Fact label="Where">
            {revealed ? (
              <>
                {event.venueName && <span className="block">{event.venueName}</span>}
                <AddressLink
                  address={event.address}
                  venueName={event.venueName}
                  className="theme-subtle"
                />
                {event.doorCode && (
                  <span className="block font-mono text-xs mt-1">
                    venue door code <strong>{event.doorCode}</strong>
                  </span>
                )}
                {event.threeWordHint && <ThreeWordHint hint={event.threeWordHint} />}
                {event.mapUrl && (
                  <a
                    href={event.mapUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-block mt-2 font-mono text-xs underline hover:opacity-70 transition-opacity"
                  >
                    open in maps ↗
                  </a>
                )}
                {event.transportNote && (
                  <span className="block theme-muted text-sm mt-2">{event.transportNote}</span>
                )}
              </>
            ) : (
              <>
                {event.area ?? "London"}
                <span className="block font-mono text-micro theme-muted mt-1">
                  exact address once you have a ticket
                </span>
              </>
            )}
          </Fact>

          {event.lineup.length > 0 && (
            <Fact label="Lineup">
              <span className="flex flex-wrap gap-x-2 gap-y-1">
                {event.lineup.map((name, index) => (
                  <span key={name}>
                    {name}
                    {index < event.lineup.length - 1 && (
                      <span className="theme-faint ml-2" aria-hidden="true">
                        ·
                      </span>
                    )}
                  </span>
                ))}
              </span>
            </Fact>
          )}
        </dl>

        {/* Tickets — the point of the page, kept high. */}
        {ticketsExist && (
          <section id="tickets" className="mt-10 scroll-mt-6">
            <h2 className="font-mono text-micro theme-muted tracking-widest uppercase py-2">
              Tickets
            </h2>
            <div className="border-t theme-border">
              {availability.map((entry) => (
                <ClaimTicketForm
                  key={entry.type.id}
                  eventSlug={event.slug}
                  availability={entry}
                  hasTicketTerms={Boolean(event.terms)}
                  hasRefundPolicy={Boolean(event.refundPolicy)}
                />
              ))}
            </div>
            <div className="mt-4">
              <ResendTicketForm eventSlug={event.slug} />
            </div>
          </section>
        )}

        {event.description && (
          <EventDescription content={event.description} pitchShowcase={pitchShowcase} />
        )}

        {(event.dressCode ||
          event.ageLimit ||
          event.stepFreeAccess !== undefined ||
          event.houseRules) && (
          <section className="mt-12">
            <h2 className="font-mono text-micro theme-muted tracking-widest uppercase py-2">
              Good to know
            </h2>
            <dl className="divide-y theme-border border-y theme-border py-2">
              {event.dressCode && <Fact label="Dress">{event.dressCode}</Fact>}
              {event.ageLimit && <Fact label="Age">{event.ageLimit}</Fact>}
              {event.stepFreeAccess !== undefined && (
                <Fact label="Access">
                  {event.stepFreeAccess
                    ? "Step-free access."
                    : "There are stairs and no step-free access — ask us if that's a problem and we'll sort something."}
                </Fact>
              )}
              {event.houseRules && (
                <Fact label="House">
                  <div className="space-y-3">
                    <PolicyMarkdown>{event.houseRules}</PolicyMarkdown>
                  </div>
                </Fact>
              )}
            </dl>
          </section>
        )}

        <section className="mt-12 flex flex-wrap gap-4">
          <a
            href={eventIcsPath(event.slug)}
            className="font-mono text-xs theme-muted hover:text-foreground transition-colors underline"
          >
            add to calendar
          </a>
        </section>

        <section id="ticket-terms" className="mt-10 scroll-mt-6 border-t theme-border pt-6">
          <h2 className="font-mono text-micro theme-muted tracking-widest uppercase">
            Ticket terms
          </h2>
          <div className="mt-3 space-y-4 font-mono text-micro theme-muted leading-relaxed">
            {event.terms ? (
              <PolicyMarkdown>{event.terms}</PolicyMarkdown>
            ) : (
              <p>
                Tickets are for this named, dated event. Entry is subject to the event details and
                house rules shown above.
              </p>
            )}
          </div>
        </section>

        <section id="refund-terms" className="mt-8 scroll-mt-6 border-t theme-border pt-6">
          <h2 className="font-mono text-micro theme-muted tracking-widest uppercase">
            Refund terms
          </h2>
          <div className="mt-3 space-y-4 font-mono text-micro theme-muted leading-relaxed">
            {event.refundPolicy ? (
              <PolicyMarkdown>{event.refundPolicy}</PolicyMarkdown>
            ) : (
              <p>
                Self-serve refunds are available before doors open while nobody on the order has
                checked in. After that, contact us so the door record can be reviewed.
              </p>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t theme-border">
        <div className="max-w-2xl mx-auto px-6 py-8 flex items-center justify-between font-mono text-micro theme-muted tracking-wide">
          <span>
            © {new Date().getFullYear()} {SITE_BRAND}
          </span>
          <div className="flex items-center gap-4">
            <Link to="/privacy" className="hover:text-foreground transition-colors">
              privacy
            </Link>
            <Link to="/contact" className="hover:text-foreground transition-colors">
              contact
            </Link>
            <Link to="/events" className="hover:text-foreground transition-colors">
              all events
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
