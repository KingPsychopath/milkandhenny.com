"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { SITE_BRAND } from "@/lib/shared/config";
import { useQrCode } from "@/hooks/useQrCode";
import { eventIcsPath, ticketIcsPath } from "@/features/events/routes";
import { AddressLink } from "@/features/events/ui/AddressLink";
import { ThreeWordHint } from "@/features/events/ui/ThreeWordHint";
import { formatEventDate, formatEventTime, formatMoney } from "@/features/events/types";
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
 * Near-full, so one ticket is the thing on screen and the QR is as big as the
 * column allows — this page gets held up to a scanner. The few percent held
 * back leave a sliver of the next card, which is what says "there are more"
 * without a caption; the counter below says how many.
 */
const TICKET_TRACK_WIDTH = "92%";

/** Pixels of movement that turn a click into a drag. */
const DRAG_SLOP = 6;

/** How long the glide to the nearest ticket takes. */
const GLIDE_MS = 320;

type TrackPhase = "idle" | "dragging" | "settling";

/**
 * Which card the track has settled on.
 *
 * Measured from scroll position rather than tracked as state the buttons own,
 * so a swipe and a tap on the dots cannot disagree about where we are.
 */
/**
 * Which card sits nearest the middle of the track.
 *
 * Measured with getBoundingClientRect so the card and the track are in the
 * same coordinate space. `offsetLeft` is relative to the nearest positioned
 * ancestor rather than the scroll container, so comparing it against
 * `scrollLeft` reads correctly only while the column happens to sit flush
 * left — it drifts by a whole card once `max-w-md` starts centring it.
 */
function measureNearest(track: HTMLElement): { index: number; offset: number } {
  const trackBox = track.getBoundingClientRect();
  const centre = trackBox.left + trackBox.width / 2;
  let index = 0;
  let offset = 0;
  let shortest = Number.POSITIVE_INFINITY;
  for (const [candidate, card] of [...track.children].entries()) {
    const box = card.getBoundingClientRect();
    const delta = box.left + box.width / 2 - centre;
    if (Math.abs(delta) < shortest) {
      shortest = Math.abs(delta);
      index = candidate;
      offset = delta;
    }
  }
  return { index, offset };
}

/**
 * Suspend and restore CSS snapping on the track itself.
 *
 * Inline style rather than a class, so it lands in the same tick as the scroll
 * writes that depend on it. Touch never routes through here, so a finger keeps
 * native snapping throughout.
 */
function suspendSnap(track: HTMLElement) {
  track.style.scrollSnapType = "none";
}

function restoreSnap(track: HTMLElement) {
  track.style.removeProperty("scroll-snap-type");
}

function useActiveCard(count: number) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  // "settling" is its own phase because CSS snap cannot do this part: turning
  // `scroll-snap-type` back on makes the browser jump to the nearest point
  // instantly, so it has to stay off until our own smooth scroll has finished.
  const [phase, setPhase] = useState<TrackPhase>("idle");
  const phaseRef = useRef<TrackPhase>("idle");
  const frame = useRef<number | null>(null);
  /** Where an in-flight glide is heading, so it can be completed instantly. */
  const glideTarget = useRef<number | null>(null);

  const enterPhase = useCallback((next: TrackPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const sync = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setActive(measureNearest(track).index);
  }, []);

  /**
   * Glide the track by `delta`, then hand snapping back.
   *
   * Hand-animated rather than `scrollBy({ behavior: "smooth" })`, because a
   * mandatory snap container cancels a programmatic smooth scroll the moment
   * it targets anything that is not a snap point — the scroll silently does
   * nothing and the card arrives by an instant snap instead, which is the jump
   * this is meant to replace. Driving the frames means snapping stays off for
   * exactly as long as the animation lasts, with no timer guessing at it.
   */
  const glideBy = useCallback(
    (delta: number) => {
      const track = trackRef.current;
      if (!track) return;
      if (frame.current) cancelAnimationFrame(frame.current);

      // Snap is suspended on the element, not via a class. Each frame writes
      // `scrollLeft`, and a mandatory snap container re-snaps every such write
      // the instant it lands — so waiting for React to re-render a `snap-none`
      // class is a race the first frame loses, and the glide collapses into
      // the jump it was meant to replace.
      suspendSnap(track);

      const reduceMotion =
        typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (Math.abs(delta) < 1 || reduceMotion) {
        track.scrollLeft += delta;
        glideTarget.current = null;
        restoreSnap(track);
        enterPhase("idle");
        return;
      }

      const from = track.scrollLeft;
      glideTarget.current = from + delta;
      const startedAt = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / GLIDE_MS);
        const eased = 1 - (1 - progress) ** 3;
        track.scrollLeft = from + delta * eased;
        if (progress < 1) {
          frame.current = requestAnimationFrame(step);
        } else {
          frame.current = null;
          glideTarget.current = null;
          restoreSnap(track);
          enterPhase("idle");
        }
      };
      frame.current = requestAnimationFrame(step);
    },
    [enterPhase],
  );

  /** Let go of a free drag and glide to whichever ticket is closest. */
  const settle = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const { index, offset } = measureNearest(track);
    setActive(index);
    enterPhase("settling");
    glideBy(offset);
  }, [enterPhase, glideBy]);

  const goTo = useCallback(
    (index: number) => {
      const track = trackRef.current;
      const card = track?.children[index];
      if (!track || !card) return;
      const trackBox = track.getBoundingClientRect();
      const box = card.getBoundingClientRect();
      setActive(index);
      enterPhase("settling");
      glideBy(box.left + box.width / 2 - (trackBox.left + trackBox.width / 2));
    },
    [enterPhase, glideBy],
  );

  // A trimmed order must not leave the counter pointing past the last ticket.
  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, count - 1)));
  }, [count]);

  /**
   * Land the glide immediately instead of animating it.
   *
   * Browsers pause requestAnimationFrame in a background tab, so a glide that
   * is interrupted by the reader switching away would never reach its last
   * frame — leaving snapping suspended and the track parked between two
   * tickets until something else scrolled it.
   */
  const finishGlide = useCallback(() => {
    const track = trackRef.current;
    if (frame.current) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    if (track) {
      if (glideTarget.current !== null) track.scrollLeft = glideTarget.current;
      restoreSnap(track);
    }
    glideTarget.current = null;
    enterPhase("idle");
  }, [enterPhase]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && frame.current !== null) finishGlide();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [finishGlide]);

  // Click-and-drag, for the mouse.
  //
  // A touch screen and a trackpad both scroll this track natively; a mouse
  // does not, and on a desktop the cards look grabbable, so they should be.
  // Only `mouse` pointers are intercepted — hijacking touch would replace a
  // good native scroll with a worse imitation of it.
  const drag = useRef({ startX: 0, startScroll: 0, travelled: 0 });

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const track = trackRef.current;
      if (!track || event.pointerType !== "mouse" || event.button !== 0) return;
      // Grabbing again mid-glide takes over from it rather than fighting it.
      if (frame.current) cancelAnimationFrame(frame.current);
      suspendSnap(track);
      drag.current = { startX: event.clientX, startScroll: track.scrollLeft, travelled: 0 };
      enterPhase("dragging");
    },
    [enterPhase],
  );

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (phaseRef.current !== "dragging" || !track) return;
    const moved = event.clientX - drag.current.startX;
    drag.current.travelled = Math.max(drag.current.travelled, Math.abs(moved));
    // Follows the cursor exactly — no snap resistance while the button is down.
    track.scrollLeft = drag.current.startScroll - moved;
  }, []);

  const endDrag = useCallback(() => {
    if (phaseRef.current !== "dragging") return;
    settle();
  }, [settle]);

  // A drag that crossed the slop threshold was a scroll, not a tap, so swallow
  // the click it would otherwise land on whichever link sat under the cursor.
  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (drag.current.travelled <= DRAG_SLOP) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current.travelled = 0;
  }, []);

  return {
    trackRef,
    active,
    sync,
    goTo,
    phase,
    dragHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerLeave: endDrag,
      onPointerCancel: endDrag,
      onClickCapture,
    },
  };
}

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
        {/* The same route either way — a ticket page. It just carries the
            order controls when the ticket is the purchaser's, so the label
            should not imply a separate "manage" screen that does not exist. */}
        <Link to="/ticket/$id" params={{ id: ticketId }} className={LINK_CLASS}>
          {isBuyer ? "open your ticket" : "open full ticket"}
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
  const ticketCount = outcome.state === "complete" ? outcome.tickets.length : 0;
  const { trackRef, active, sync, goTo, phase, dragHandlers } = useActiveCard(ticketCount);

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
        <>
          <div
            ref={trackRef}
            onScroll={sync}
            {...dragHandlers}
            role="group"
            aria-label={`${tickets.length} tickets in this order`}
            // Snapping is declared here but suspended imperatively whenever a
            // drag or a glide is in flight — see `suspendSnap`. This class only
            // carries the cursor and text-selection state.
            className={`mt-6 -mx-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
              phase === "dragging" ? "cursor-grabbing select-none" : "cursor-grab"
            }`}
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

          {/* Position and stepper. Amber is the one accent this palette
              spends, and a "which of these am I looking at" marker is
              exactly the kind of small orienting thing worth spending it on. */}
          <div className="mt-3 flex items-center justify-between gap-4">
            <p
              className="font-mono text-micro tracking-wide"
              style={{ color: "var(--prose-hashtag)" }}
              aria-live="polite"
            >
              ticket {active + 1} of {tickets.length}
            </p>
            <div className="flex items-center gap-1">
              {tickets.map((ticket, index) => {
                const current = index === active;
                return (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => goTo(index)}
                    aria-label={`Show ${ticket.holderName}'s ticket`}
                    aria-current={current ? "true" : undefined}
                    className="group grid size-7 place-items-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
                  >
                    {/* Grows on hover and dips on press, so the dot answers the
                        tap before the track has finished sliding. The active one
                        is already at full size — it should not flinch. */}
                    <span
                      className={`block rounded-full transition-[transform,opacity,background-color] duration-150 ease-out ${
                        current
                          ? "size-2 opacity-100"
                          : "size-1.5 opacity-30 group-hover:scale-150 group-hover:opacity-70 group-active:scale-90"
                      }`}
                      style={{
                        backgroundColor: current ? "var(--prose-hashtag)" : "var(--foreground)",
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {!single && (
        <p className="mt-3 font-mono text-micro theme-muted leading-relaxed">
          Swipe for each guest&apos;s QR. Send them theirs and they can be scanned in without you —
          keep the first one, it&apos;s yours and it&apos;s the only one that can refund the order.
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
