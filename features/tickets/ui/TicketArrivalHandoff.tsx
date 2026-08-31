"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { getTicketArrivalStateFn } from "@/features/event-operations/ticket-arrival.functions";
import {
  markTicketArrivalHandoffOffered,
  shouldOfferTicketArrivalHandoff,
  wasTicketArrivalHandoffOffered,
} from "../ticket-arrival-handoff.client";
import { subscribeTicketStream } from "../ticket-event-stream";

const FALLBACK_POLL_MS = 7_000;
const MIN_RECONCILE_GAP_MS = 1_500;
const HANDOFF_DELAY_MS = 1_800;

export function TicketArrivalHandoff({
  ticketReference,
  eventSlug,
  initialRedeemedAt,
}: {
  ticketReference: string;
  eventSlug: string;
  initialRedeemedAt?: string;
}) {
  const [checkedIn, setCheckedIn] = useState(Boolean(initialRedeemedAt));
  const [transitioning, setTransitioning] = useState(false);
  const checkedInOnLoad = useRef(Boolean(initialRedeemedAt));
  const handoffOffered = useRef(Boolean(initialRedeemedAt));
  const lastCheckedAt = useRef(0);
  const stopped = useRef(false);
  const navigationTimer = useRef<number | null>(null);
  const stayButton = useRef<HTMLButtonElement>(null);
  const destination = `/events/${encodeURIComponent(eventSlug)}/icebreaker?ticket=${encodeURIComponent(ticketReference)}`;

  const cancelNavigation = useCallback(() => {
    if (navigationTimer.current !== null) {
      window.clearTimeout(navigationTimer.current);
      navigationTimer.current = null;
    }
    setTransitioning(false);
  }, []);

  const reconcile = useCallback(async () => {
    if (stopped.current || Date.now() - lastCheckedAt.current < MIN_RECONCILE_GAP_MS) return;
    lastCheckedAt.current = Date.now();
    const state = await getTicketArrivalStateFn({ data: { ticketReference } }).catch(() => null);
    if (!state?.found) {
      if (state && !state.found) stopped.current = true;
      return;
    }
    if (state.arrivalExperience !== "icebreaker") {
      stopped.current = true;
      return;
    }
    if (!state.redeemedAt) return;
    setCheckedIn(true);
    if (
      !shouldOfferTicketArrivalHandoff({
        checkedInOnLoad: checkedInOnLoad.current,
        alreadyOffered: handoffOffered.current,
        redeemedAt: state.redeemedAt,
      })
    ) {
      return;
    }
    handoffOffered.current = true;
    markTicketArrivalHandoffOffered(window.sessionStorage, ticketReference);
    setTransitioning(true);
    navigationTimer.current = window.setTimeout(() => {
      navigationTimer.current = null;
      window.location.assign(destination);
    }, HANDOFF_DELAY_MS);
  }, [destination, ticketReference]);

  useEffect(() => {
    if (checkedInOnLoad.current) return;
    handoffOffered.current = wasTicketArrivalHandoffOffered(window.sessionStorage, ticketReference);
    const unsubscribe = subscribeTicketStream(ticketReference, (event) => {
      if (event.kind === "ready" || event.kind === "checked-in") void reconcile();
    });
    void reconcile();
    const timer = window.setInterval(() => void reconcile(), FALLBACK_POLL_MS);
    const onFocus = () => void reconcile();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void reconcile();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reconcile, ticketReference]);

  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      handoffOffered.current = true;
      cancelNavigation();
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [cancelNavigation]);

  useEffect(() => {
    if (!transitioning) return;
    stayButton.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelNavigation();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancelNavigation, transitioning]);

  useEffect(
    () => () => {
      if (navigationTimer.current !== null) window.clearTimeout(navigationTimer.current);
    },
    [],
  );

  return (
    <>
      <section className="mt-6 border-y theme-border py-4">
        <p className="font-mono text-micro uppercase tracking-[0.18em] theme-muted">
          {checkedIn ? "optional arrival icebreaker" : "after the door scan"}
        </p>
        <div className="mt-2 flex items-center justify-between gap-4">
          <p className="font-serif text-lg leading-snug text-foreground">
            {checkedIn
              ? "Warm up whenever you like. Your ticket stays right here."
              : "This opens once when you’re scanned in. You can come straight back to your ticket."}
          </p>
          {checkedIn ? (
            <Link
              to="/events/$slug/icebreaker"
              params={{ slug: eventSlug }}
              search={{ ticket: ticketReference }}
              className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-foreground px-4 font-mono text-xs text-background hover:opacity-75"
            >
              start →
            </Link>
          ) : (
            <span
              className="arrival-pulse h-3 w-3 shrink-0 rounded-full bg-[var(--prose-hashtag)]"
              aria-hidden="true"
            />
          )}
        </div>
      </section>
      {transitioning ? (
        <div
          className="arrival-handoff fixed inset-0 z-[100] grid place-content-center px-6 text-center text-white"
          role="dialog"
          aria-modal="true"
          aria-labelledby="arrival-handoff-title"
        >
          <div className="arrival-handoff-orb mx-auto h-28 w-28 rounded-full" aria-hidden="true" />
          <p className="mt-8 font-mono text-micro uppercase tracking-[0.22em] text-white/65">
            you’re in
          </p>
          <p id="arrival-handoff-title" className="mt-3 font-serif text-4xl">
            Let’s find your people.
          </p>
          <p className="mt-3 font-mono text-xs text-white/60">opening the quick icebreaker…</p>
          <button
            ref={stayButton}
            type="button"
            onClick={cancelNavigation}
            className="mx-auto mt-6 inline-flex min-h-11 items-center px-4 font-mono text-xs text-white/75 underline underline-offset-4 hover:text-white focus-visible:ring-2 focus-visible:ring-white"
          >
            stay on my ticket
          </button>
        </div>
      ) : null}
    </>
  );
}
