import { Link } from "@tanstack/react-router";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { JourneyRail } from "@/components/SiteFooter";
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
import { imagePlaceholderStyle, type ResponsiveImageData } from "@/features/media/image";
import type { TicketTypeAvailability } from "@/features/event-operations/event-page.server";
import { AddressLink } from "./AddressLink";
import { ThreeWordHint } from "./ThreeWordHint";
import { ClaimTicketForm } from "./ClaimTicketForm";
import { ResendTicketForm } from "./ResendTicketForm";
import { EventDescription } from "./EventDescription";
import { EventWaitlistForm, type EventWaitlistOption } from "./EventWaitlistForm";

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

function StatusBanner({ status, soldOut }: { status: ViewableEvent["status"]; soldOut: boolean }) {
  if (status === "published" && !soldOut) return null;

  const copy =
    status === "cancelled"
      ? "This event has been cancelled."
      : status === "sold-out" || soldOut
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
  soldOut,
  pitchShowcase,
  heroImage,
  descriptionImages,
  checkoutCancelled = false,
  waitlistEmail,
}: {
  event: ViewableEvent;
  availability: TicketTypeAvailability[];
  soldOut: boolean;
  pitchShowcase?: PublicPitchDeck[];
  heroImage?: ResponsiveImageData;
  descriptionImages?: Record<string, ResponsiveImageData>;
  /** Set when Stripe sent them back without taking payment. */
  checkoutCancelled?: boolean;
  waitlistEmail?: string;
}) {
  const revealed = isRevealed(event);
  const ticketsExist = hasTickets(event);
  const doorsAt = event.doorsAt;
  const doorsDifferFromStart =
    doorsAt && new Date(doorsAt).getTime() !== new Date(event.startsAt).getTime();
  const soldOutTypes = availability.filter((entry) => entry.sales.state === "sold-out");
  const waitlistOptions: EventWaitlistOption[] = event.waitlistEnabled
    ? [
        ...(soldOut
          ? [
              {
                value: "event",
                label: "any ticket for this event",
                scope: { kind: "event" as const },
              },
            ]
          : []),
        ...soldOutTypes
          .filter(() => !soldOut || availability.length > 1)
          .map((entry) => ({
            value: `ticket:${entry.type.id}`,
            label: `${entry.type.name} only`,
            scope: { kind: "ticket-type" as const, ticketTypeId: entry.type.id },
          })),
      ]
    : [];

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="max-w-2xl mx-auto px-6 pt-12 pb-6">
        <Link
          to="/events"
          className="font-mono text-micro theme-muted tracking-wide hover:text-foreground transition-colors"
        >
          ← {SITE_BRAND} events
        </Link>
      </header>

      <main id="main" className="max-w-2xl mx-auto flex-1 px-6 pb-24">
        <StatusBanner status={event.status} soldOut={soldOut} />

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
          <div
            className="media-image-placeholder mb-8 overflow-hidden rounded-lg bg-surface"
            style={imagePlaceholderStyle(heroImage?.placeholder)}
          >
            <AppImage
              src={heroImage?.src ?? event.heroImage}
              srcSet={heroImage?.srcSet}
              sources={heroImage?.sources}
              alt=""
              width={heroImage?.width ?? event.heroImageWidth}
              height={heroImage?.height ?? event.heroImageHeight}
              reveal
              sizes="(min-width: 672px) 624px, calc(100vw - 3rem)"
              className={`h-auto w-full ${heroImageHeightClass(event.heroHeight)}`}
              priority
            />
          </div>
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
            <EventWaitlistForm
              eventSlug={event.slug}
              options={waitlistOptions}
              initialEmail={waitlistEmail}
            />
          </section>
        )}

        {event.description && (
          <EventDescription
            content={event.description}
            pitchShowcase={pitchShowcase}
            images={descriptionImages}
          />
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
                house rules shown above. Transfers are reassignment or gifting only; Milk &amp;
                Henny does not arrange or protect private resale payments.
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
                Eligible self-serve refunds apply to the selected, unused ticket before doors open.
                Money returns only to the original payment method. A transferred ticket needs the
                purchaser and current holder to agree. After check-in, contact us so the door record
                can be reviewed.
              </p>
            )}
          </div>
        </section>
      </main>

      <JourneyRail
        trailing={
          <Link to="/events" className="hover:text-foreground transition-colors">
            view all events →
          </Link>
        }
      />
    </div>
  );
}
