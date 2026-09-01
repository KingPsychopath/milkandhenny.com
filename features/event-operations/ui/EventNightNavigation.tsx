import { Link, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ATTENDEE_CLAIMS_EVENT,
  attendeeClaimSummary,
} from "@/features/event-scoring/attendee-claims.client";
import { SCORE_SESSION_EVENT } from "@/features/event-scoring/client-sync";
import { useGameNavigationSafety } from "@/features/things/shared/useSafeGameNavigation";
import { subscribeTicketStream } from "@/features/tickets/ticket-event-stream";
import { getEventNightContextsFn } from "../event-night.functions";
import { eventNightStatus, isCurrentEvent } from "../event-night";
import type { EventNightContext } from "../event-night.types";

const REFRESH_MS = 7_000;

function eventSlugFromPath(pathname: string): string | undefined {
  const value = pathname.match(/^\/events\/([^/]+)/)?.[1];
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function EventNightNavigation({
  authenticated,
  initialContexts,
}: {
  authenticated: boolean;
  initialContexts: EventNightContext[];
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const safeGameScreen = useGameNavigationSafety();
  const [contexts, setContexts] = useState(initialContexts);
  const [online, setOnline] = useState(true);
  const [claims, setClaims] = useState({ pending: 0, rejected: 0 });
  const refresh = useCallback(() => {
    void getEventNightContextsFn()
      .then(setContexts)
      .catch(() => undefined);
  }, []);
  const requestedEventSlug = eventSlugFromPath(pathname);
  const context = useMemo(() => {
    if (requestedEventSlug) return contexts.find((entry) => entry.eventSlug === requestedEventSlug);
    const current = contexts.filter((entry) => isCurrentEvent(entry));
    if (
      pathname === "/things" ||
      pathname.startsWith("/things/") ||
      pathname.startsWith("/drop/") ||
      pathname.startsWith("/pics/")
    ) {
      return current.at(-1);
    }
    return undefined;
  }, [contexts, pathname, requestedEventSlug]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const updateNetwork = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    window.addEventListener(SCORE_SESSION_EVENT, refresh);
    window.addEventListener("mah-score-wake", refresh);
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", updateNetwork);
      window.removeEventListener("offline", updateNetwork);
      window.removeEventListener(SCORE_SESSION_EVENT, refresh);
      window.removeEventListener("mah-score-wake", refresh);
    };
  }, [refresh]);

  useEffect(() => {
    const eventSlug = context?.eventSlug;
    const participantId = context?.participantId;
    const ticketId = context?.ticketId;
    if (!eventSlug || !participantId || !ticketId) {
      setClaims({ pending: 0, rejected: 0 });
      return;
    }
    const update = () =>
      void attendeeClaimSummary(eventSlug, participantId)
        .then(({ pending, rejected }) => setClaims({ pending, rejected }))
        .catch(() => undefined);
    update();
    window.addEventListener(ATTENDEE_CLAIMS_EVENT, update);
    const timer = window.setInterval(update, 5_000);
    const unsubscribe = subscribeTicketStream(ticketId, (event) => {
      if (event.kind !== "unavailable") refresh();
    });
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(ATTENDEE_CLAIMS_EVENT, update);
      unsubscribe();
    };
  }, [context?.eventSlug, context?.participantId, context?.ticketId, refresh]);

  const hiddenSurface =
    pathname === "/my" || pathname.startsWith("/access") || pathname.startsWith("/admin");
  const unsafeGame = pathname.startsWith("/things/") && !safeGameScreen;
  if (hiddenSurface || unsafeGame) return null;

  if (!context || pathname.startsWith("/ticket/")) {
    return (
      <Link
        to={authenticated ? "/my" : "/access"}
        search={authenticated ? undefined : { returnTo: "/my" }}
        className="mh-action mh-action--quiet fixed right-20 top-2 z-30 theme-muted"
      >
        account
      </Link>
    );
  }

  const ticketHref = `/ticket/${encodeURIComponent(context.ticketId)}`;
  const recoveryHref = `${ticketHref}#ticket-recovery`;
  return (
    <nav
      aria-label="Your event ticket"
      className="event-night-nav themed-floating-notice fixed inset-x-3 z-30 mx-auto grid max-w-xl grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-2xl border p-2 font-mono text-micro shadow-lg backdrop-blur-xl sm:flex"
    >
      <div className="min-w-0 flex-1 px-2">
        <p className="truncate text-[var(--floating-notice-foreground)]">
          {context.holderName}&apos;s ticket
        </p>
        <p className="truncate themed-floating-notice-muted" role="status">
          {eventNightStatus(context, online, claims)}
        </p>
      </div>
      <div className="col-span-2 grid grid-cols-3 gap-2 sm:contents">
        <Link
          to="/ticket/$id"
          params={{ id: context.ticketId }}
          className="mh-action mh-action--primary min-w-0 justify-center sm:shrink-0"
        >
          {context.active ? "ticket" : "choose ticket"}
        </Link>
        <Link
          to="/events/$slug/score"
          params={{ slug: context.eventSlug }}
          className="mh-action mh-action--quiet min-w-0 justify-center sm:shrink-0"
        >
          score
        </Link>
        {context.savedToAccount ? (
          <Link to="/my" className="mh-action mh-action--quiet min-w-0 justify-center sm:shrink-0">
            account
          </Link>
        ) : authenticated ? (
          <a
            href={recoveryHref}
            className="mh-action mh-action--quiet min-w-0 justify-center sm:shrink-0"
          >
            save
          </a>
        ) : (
          <Link
            to="/access"
            search={{ returnTo: recoveryHref }}
            className="mh-action mh-action--quiet min-w-0 justify-center sm:shrink-0"
          >
            save
          </Link>
        )}
      </div>
    </nav>
  );
}
