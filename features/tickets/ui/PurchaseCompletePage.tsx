"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { SITE_BRAND } from "@/lib/shared/config";
import { useQrCode } from "@/hooks/useQrCode";
import { eventIcsPath, ticketIcsPath } from "@/features/events/routes";
import { AddressLink } from "@/features/events/ui/AddressLink";
import {
  formatEventDate,
  formatEventTime,
  formatMoney,
  threeWordMapUrl,
} from "@/features/events/types";
import type { TicketStatus } from "../types";
import {
  getCheckoutOutcomeFn,
  resendTicketsFn,
  type CheckoutOutcomeResult,
} from "../tickets.functions";
import { ShareTicketButton } from "./ShareTicketButton";

/**
 * The moment after paying.
 *
 * Until now this redirect landed back on the event page with a query
 * parameter nothing read, so the only evidence a purchase had happened was
 * an email that had not arrived yet. What someone actually wants here is the
 * QR — in front of them, immediately — then proof of what they paid for, then
 * the two or three things worth doing before they close the tab.
 *
 * Tickets are issued by the Stripe webhook, so `pending` is an ordinary
 * state on arrival rather than a failure, and this page waits it out.
 */

/** Well past a healthy webhook, short enough that a broken one is not a vigil. */
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 90_000;

const LINK_CLASS =
  "font-mono text-xs theme-muted hover:text-foreground transition-colors underline";

/**
 * How wide each ticket sits in the swipe track.
 *
 * Under 100% so the next ticket peeks, which is the whole affordance — it
 * says "there are more" without a caption. The count in the summary line
 * above says how many, so nothing is hidden by scrolling sideways.
 *
 * This beats stacking vertically on the axis that matters: a QR has to be
 * big to scan, and one card at 82% of the column is a larger code than three
 * shrunk to fit down the page, with every ticket still one swipe away rather
 * than behind a "show more".
 */
const TICKET_TRACK_WIDTH = "82%";

type PollState = "waiting" | "settled" | "timed-out";

function useCheckoutOutcome(sessionId: string, initial: CheckoutOutcomeResult) {
  const [outcome, setOutcome] = useState(initial);
  const [poll, setPoll] = useState<PollState>(initial.state === "pending" ? "waiting" : "settled");
  // Ref-stable so a parent re-render cannot restart the interval — the guest
  // list incident in docs/ is exactly this loop, without the guard.
  const startedAt = useRef(Date.now());
  const inFlight = useRef(false);

  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await getCheckoutOutcomeFn({ data: { sessionId } });
      setOutcome(next);
      // Anything but `pending` is terminal: nothing here retries a settled
      // answer, and `unknown` means the id is not ours to wait on.
      if (next.state !== "pending") setPoll("settled");
      else if (Date.now() - startedAt.current > POLL_TIMEOUT_MS) setPoll("timed-out");
    } catch {
      // A dropped request is not an answer. Keep waiting; the deadline ends it.
      if (Date.now() - startedAt.current > POLL_TIMEOUT_MS) setPoll("timed-out");
    } finally {
      inFlight.current = false;
    }
  }, [sessionId]);

  useEffect(() => {
    if (poll !== "waiting") return;
    const timer = setInterval(() => void check(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [poll, check]);

  const retry = useCallback(() => {
    startedAt.current = Date.now();
    setPoll("waiting");
  }, []);

  return { outcome, poll, retry };
}

function Shell({ slug, children }: { slug: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <main id="main" className="max-w-md mx-auto px-6 pt-10 pb-16">
        <Link
          to="/events/$slug"
          params={{ slug }}
          className="font-mono text-micro theme-muted tracking-wide hover:text-foreground transition-colors"
        >
          ← back to the event
        </Link>
        {children}
        <p className="mt-10 text-center font-mono text-micro theme-faint tracking-wide">
          {SITE_BRAND.toLowerCase()}
        </p>
      </main>
    </div>
  );
}

function TicketQr({
  qrPayload,
  holderName,
  ticketId,
  eventTitle,
  timezone,
  status,
  redeemedAt,
  large,
  isBuyer,
}: {
  qrPayload: string;
  holderName: string;
  ticketId: string;
  eventTitle: string;
  timezone: string;
  status: TicketStatus;
  redeemedAt?: string;
  large: boolean;
  /**
   * The purchaser's own ticket. It is the order's credential — it opens every
   * sibling QR and the refund button — so it is deliberately not shareable.
   */
  isBuyer: boolean;
}) {
  const { dataUrl: qr, failed } = useQrCode(qrPayload, large ? 512 : 320);
  const invalid = status !== "valid";

  return (
    <div className="py-5">
      <div className="flex justify-center">
        {/* Dimmed only when the ticket is actually void. A scanned-in ticket
            still has to produce this code at a checkpoint. */}
        <div
          className={`w-full aspect-square rounded-xl bg-white p-4 ${
            large ? "max-w-xs" : "max-w-[13rem]"
          } ${invalid ? "opacity-30" : ""}`}
        >
          {qr ? (
            <img
              src={qr}
              alt={`Ticket QR code for ${holderName}. Show this at the door.`}
              className="w-full h-full"
            />
          ) : failed ? (
            <div className="w-full h-full flex items-center justify-center text-center">
              <p className="font-mono text-xs text-stone-600 px-4">
                Couldn&apos;t draw the code. The reference below still works at the door.
              </p>
            </div>
          ) : (
            <div className="w-full h-full" aria-hidden="true" />
          )}
        </div>
      </div>

      <p className="mt-3 text-center font-serif text-lg text-foreground">{holderName}</p>
      <p className="mt-1 text-center font-mono text-micro theme-subtle tracking-[0.2em]">
        {ticketId}
      </p>
      {invalid ? (
        <p className="mt-2 text-center font-mono text-micro theme-muted">
          {status === "refunded" ? "refunded — no longer valid" : "no longer valid"}
        </p>
      ) : redeemedAt ? (
        <p className="mt-2 text-center font-mono text-micro theme-muted">
          scanned in {formatEventTime(redeemedAt, timezone)}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-4">
        <Link to="/ticket/$id" params={{ id: ticketId }} className={LINK_CLASS}>
          {isBuyer ? "manage this order" : "open full ticket"}
        </Link>
        {/* Nothing to send once a ticket is void — it would not admit anyone. */}
        {!isBuyer && !invalid && (
          <ShareTicketButton
            ticketId={ticketId}
            holderName={holderName}
            eventTitle={eventTitle}
            className="text-xs"
            label="send to them"
          />
        )}
      </div>
    </div>
  );
}

/**
 * The delivery address, tappable to send the tickets again.
 *
 * The address is here anyway so a typo is visible; making it the control means
 * the fix is in the same place as the problem, rather than sending someone
 * back to the event page to hunt for a resend form.
 *
 * `resendTicketsFn` deliberately reports success whether or not it matched
 * anything, so there is nothing to report but "sent" — and it dedupes on a
 * one-minute idempotency window, so an impatient second tap cannot mail
 * somebody twice.
 */
function ResendToEmail({ eventSlug, email }: { eventSlug: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  const resend = async () => {
    setState("sending");
    try {
      await resendTicketsFn({ data: { eventSlug, email } });
    } catch {
      // Nothing actionable to say: the tickets already exist and this page is
      // still showing them. Claiming failure would be worse than staying quiet.
    }
    setState("sent");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="underline decoration-dotted underline-offset-2 hover:text-foreground transition-colors"
      >
        {email}
      </button>
      {open && (
        <>
          {" · "}
          {state === "sent" ? (
            <span className="theme-subtle">sent again — check spam if it&apos;s not there</span>
          ) : (
            <button
              type="button"
              onClick={() => void resend()}
              disabled={state === "sending"}
              className="underline underline-offset-2 hover:text-foreground transition-colors disabled:opacity-50"
            >
              {state === "sending" ? "sending..." : "send again"}
            </button>
          )}
        </>
      )}
    </>
  );
}

export function PurchaseCompletePage({
  slug,
  sessionId,
  initialOutcome,
}: {
  slug: string;
  sessionId: string;
  initialOutcome: CheckoutOutcomeResult;
}) {
  const { outcome, poll, retry } = useCheckoutOutcome(sessionId, initialOutcome);

  if (outcome.state === "unknown") {
    return (
      <Shell slug={slug}>
        <h1 className="mt-8 font-serif text-2xl text-foreground leading-tight">
          We can&apos;t find that purchase
        </h1>
        <p className="mt-3 font-serif text-sm theme-subtle leading-relaxed">
          This link doesn&apos;t match a checkout we know about. If you paid, your tickets were
          emailed to you — and you can have them sent again from the event page.
        </p>
        <Link to="/events/$slug" params={{ slug }} className={`mt-6 inline-block ${LINK_CLASS}`}>
          go to the event page
        </Link>
      </Shell>
    );
  }

  if (outcome.state === "problem") {
    return (
      <Shell slug={slug}>
        <h1 className="mt-8 font-serif text-2xl text-foreground leading-tight">
          This purchase needs a look
        </h1>
        <p className="mt-3 font-serif text-sm theme-subtle leading-relaxed">{outcome.message}</p>
        <Link to="/contact" className={`mt-6 inline-block ${LINK_CLASS}`}>
          message us
        </Link>
      </Shell>
    );
  }

  if (outcome.state === "pending") {
    return (
      <Shell slug={slug}>
        <h1 className="mt-8 font-serif text-2xl text-foreground leading-tight">
          {poll === "timed-out" ? "Your payment went through" : "Payment received"}
        </h1>
        <p className="mt-3 font-serif text-sm theme-subtle leading-relaxed">
          {poll === "timed-out"
            ? "Your tickets are taking longer than usual to appear. They will arrive by email — nothing is lost, and you do not need to pay again."
            : "We're issuing your tickets. This usually takes a couple of seconds — the QR appears here as soon as it exists."}
        </p>
        <p className="mt-4 font-mono text-micro theme-muted leading-relaxed">
          Safe to close this tab: the tickets are emailed to you either way.
        </p>
        {poll === "timed-out" && (
          <button
            type="button"
            onClick={retry}
            className="mt-6 w-full min-h-12 font-mono text-sm bg-foreground text-background rounded-lg hover-scale-slight transition-transform"
          >
            check again
          </button>
        )}
      </Shell>
    );
  }

  const { event, tickets, managerTicketId, email, amountMinor, currency } = outcome;
  const threeWordUrl = threeWordMapUrl(event.threeWordHint);
  const single = tickets.length === 1;

  return (
    <Shell slug={slug}>
      <h1 className="mt-8 font-serif text-2xl text-foreground leading-tight">
        You&apos;re in — {event.title}
      </h1>
      <p className="mt-2 font-mono text-micro theme-muted">
        {tickets.length} {tickets.length === 1 ? "ticket" : "tickets"} ·{" "}
        {formatMoney(amountMinor, currency)} paid · emailed to{" "}
        <ResendToEmail eventSlug={event.slug} email={email} />
      </p>

      {/* The QR first. Everything else on this page is secondary to being
          able to show the door something. */}
      {single ? (
        <div className="mt-6 border-y theme-border">
          <TicketQr
            qrPayload={tickets[0].qrPayload}
            holderName={tickets[0].holderName}
            ticketId={tickets[0].id}
            eventTitle={event.title}
            timezone={event.timezone}
            status={tickets[0].status}
            redeemedAt={tickets[0].redeemedAt}
            large
            isBuyer={tickets[0].id === managerTicketId}
          />
        </div>
      ) : (
        // No tabIndex on the track itself: every card holds a link and a send
        // button, so tabbing through the order scrolls it into view anyway.
        // A scroll container only needs to be focusable when nothing inside it
        // is, which would strand a keyboard entirely.
        <div
          role="group"
          aria-label={`${tickets.length} tickets in this order`}
          className="mt-6 -mx-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-2"
        >
          {tickets.map((ticket) => (
            <div
              key={ticket.id}
              style={{ width: TICKET_TRACK_WIDTH }}
              className="shrink-0 snap-center rounded-xl border theme-border"
            >
              <TicketQr
                qrPayload={ticket.qrPayload}
                holderName={ticket.holderName}
                ticketId={ticket.id}
                eventTitle={event.title}
                timezone={event.timezone}
                status={ticket.status}
                redeemedAt={ticket.redeemedAt}
                large
                isBuyer={ticket.id === managerTicketId}
              />
            </div>
          ))}
        </div>
      )}

      {!single && (
        <p className="mt-3 font-mono text-micro theme-muted leading-relaxed">
          Swipe for each guest&apos;s QR. Send them theirs and they can be scanned in without you —
          keep the first one, it&apos;s yours and it&apos;s the link that manages the order.
        </p>
      )}

      {/* The address is the thing paying just unlocked. */}
      <dl className="mt-8 divide-y theme-border border-y theme-border py-2">
        <div className="flex gap-4 py-2">
          <dt className="shrink-0 w-16 font-mono text-micro theme-muted tracking-widest uppercase pt-0.5">
            When
          </dt>
          <dd className="font-serif text-sm text-foreground leading-relaxed">
            {formatEventDate(event.startsAt, event.timezone)}
            <br />
            <span className="theme-subtle">
              {event.doorsAt ? `Doors ${formatEventTime(event.doorsAt, event.timezone)}` : ""}
              {event.lastEntryAt
                ? ` · last entry ${formatEventTime(event.lastEntryAt, event.timezone)}`
                : ""}
            </span>
          </dd>
        </div>

        <div className="flex gap-4 py-2">
          <dt className="shrink-0 w-16 font-mono text-micro theme-muted tracking-widest uppercase pt-0.5">
            Where
          </dt>
          <dd className="font-serif text-sm text-foreground leading-relaxed">
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
            {event.threeWordHint &&
              (threeWordUrl ? (
                <a
                  href={threeWordUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block font-mono text-xs theme-muted mt-1 underline hover:opacity-70 transition-opacity"
                >
                  {event.threeWordHint}
                </a>
              ) : (
                <span className="block font-mono text-xs theme-muted mt-1">
                  {event.threeWordHint}
                </span>
              ))}
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
          </dd>
        </div>

        {(event.dressCode || event.ageLimit) && (
          <div className="flex gap-4 py-2">
            <dt className="shrink-0 w-16 font-mono text-micro theme-muted tracking-widest uppercase pt-0.5">
              Note
            </dt>
            <dd className="font-serif text-sm text-foreground leading-relaxed">
              {event.dressCode && <span className="block">{event.dressCode}</span>}
              {event.ageLimit && <span className="block theme-subtle">{event.ageLimit}</span>}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
        <a
          href={single ? ticketIcsPath(managerTicketId) : eventIcsPath(event.slug)}
          className={LINK_CLASS}
        >
          add to calendar
        </a>
      </div>

      <p className="mt-6 font-mono text-micro theme-muted leading-relaxed">
        Your ticket links are permanent — bookmark one, or find them in the email. Refunds are
        self-serve from the ticket page until doors open.
      </p>
    </Shell>
  );
}
