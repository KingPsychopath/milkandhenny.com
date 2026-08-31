import { useEffect, useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";

import {
  SCORE_SESSION_EVENT,
  hasRememberedScoreSession,
  rememberedScoreLinks,
} from "../client-sync";
import { subscribeScoreStream } from "../score-event-stream";
import { getClaimedScoreLinksFn } from "../public.functions";
import { ScoreBalanceChange } from "./ScoreBalanceChange";
import { SAFE_GAME_NAVIGATION_EVENT } from "@/features/things/shared/useSafeGameNavigation";

type ScoreLink = { eventSlug: string; ticketId: string };
type Celebration = {
  id: string;
  ticketId: string;
  points: number;
  kind: string;
  balance?: number;
};

// LISTEN/NOTIFY + SSE is the fast path. This bounded reconciliation gap covers
// the small window where an award commits while a browser is still connecting.
const FALLBACK_REFRESH_MS = 5_000;
const CELEBRATION_MS = 4_500;

export function ClaimedScoreLinks() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [links, setLinks] = useState<ScoreLink[]>([]);
  const [safeGameScreen, setSafeGameScreen] = useState(false);
  const [celebrations, setCelebrations] = useState<Celebration[]>([]);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const game = pathname.startsWith("/things/");
    const update = (event?: Event) => {
      const scoreLink =
        event instanceof CustomEvent &&
        event.type === SCORE_SESSION_EVENT &&
        typeof event.detail?.eventSlug === "string" &&
        typeof event.detail?.ticketId === "string"
          ? (event.detail as ScoreLink)
          : undefined;
      if (scoreLink) {
        setLinks((current) => [
          ...current.filter((link) => link.eventSlug !== scoreLink.eventSlug),
          scoreLink,
        ]);
      }
      const safe =
        event instanceof CustomEvent && typeof event.detail?.safe === "boolean"
          ? event.detail.safe
          : document.documentElement.dataset.gameSafeNavigation === "true";
      setSafeGameScreen(safe);
      if (!game || safe) {
        if (hasRememberedScoreSession())
          setLinks((current) => {
            const merged = new Map(current.map((link) => [link.eventSlug, link]));
            for (const link of rememberedScoreLinks()) merged.set(link.eventSlug, link);
            return [...merged.values()];
          });
        void getClaimedScoreLinksFn()
          .then((discovered) =>
            setLinks((current) => {
              const merged = new Map(current.map((link) => [link.eventSlug, link]));
              for (const link of discovered) merged.set(link.eventSlug, link);
              return [...merged.values()];
            }),
          )
          .catch(() => undefined);
      }
    };
    window.addEventListener(SAFE_GAME_NAVIGATION_EVENT, update);
    window.addEventListener(SCORE_SESSION_EVENT, update);
    // Subscribe before the initial storage check so a child ticket control
    // cannot create the scoring session in the gap between those operations.
    update();
    return () => {
      window.removeEventListener(SAFE_GAME_NAVIGATION_EVENT, update);
      window.removeEventListener(SCORE_SESSION_EVENT, update);
    };
  }, [pathname]);

  const onGame = pathname.startsWith("/things/");
  const onTicket = pathname.startsWith("/ticket/");
  useEffect(() => {
    if (onTicket || links.length === 0 || (onGame && !safeGameScreen)) return;
    let active = true;
    let refreshing: Promise<void> | null = null;
    const pendingTransactionIds = new Set<string>();
    const seenNotificationIds = new Set<string>();

    async function refresh(transactionId?: string) {
      if (refreshing) {
        if (transactionId) pendingTransactionIds.add(transactionId);
        return refreshing;
      }
      refreshing = (async () => {
        const batches = await Promise.all(
          links.map(async (link) => {
            const ticketId = encodeURIComponent(link.ticketId);
            const query = transactionId
              ? `?transactionId=${encodeURIComponent(transactionId)}`
              : "";
            const noticeResponse = await fetch(
              `/api/tickets/${ticketId}/score/notifications${query}`,
              { headers: { accept: "application/json" } },
            );
            const noticeBody = noticeResponse.ok
              ? ((await noticeResponse.json()) as {
                  notifications?: Array<{
                    id: string;
                    points: number;
                    kind: string;
                    createdAt: string;
                  }>;
                })
              : undefined;
            const notifications = noticeBody?.notifications ?? [];
            if (notifications.length === 0) return { link, notifications };
            const scoreResponse = await fetch(`/api/tickets/${ticketId}/score`, {
              headers: { accept: "application/json" },
            });
            const scoreBody = scoreResponse.ok
              ? ((await scoreResponse.json()) as { participant?: { balance?: number } })
              : undefined;
            return {
              link,
              notifications,
              balance:
                typeof scoreBody?.participant?.balance === "number"
                  ? scoreBody.participant.balance
                  : undefined,
            };
          }),
        );
        if (!active) return;
        const next = batches
          .flatMap((batch) =>
            batch.notifications.map((notice) => ({
              ...notice,
              ticketId: batch.link.ticketId,
              balance: batch.balance,
            })),
          )
          .sort(
            (left, right) =>
              Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
              left.id.localeCompare(right.id),
          )
          .filter((notice) => !seenNotificationIds.has(notice.id))
          .slice(-3);
        if (next.length === 0) return;
        for (const notice of next) seenNotificationIds.add(notice.id);
        setCelebrations(next);
        clearTimeout(dismissTimer.current);
        dismissTimer.current = setTimeout(() => setCelebrations([]), CELEBRATION_MS);
        window.dispatchEvent(new Event("mah-score-wake"));
        await Promise.all(
          batches.flatMap((batch) =>
            batch.notifications.length === 0
              ? []
              : [
                  fetch(
                    `/api/tickets/${encodeURIComponent(batch.link.ticketId)}/score/notifications`,
                    {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        notificationIds: batch.notifications.map((notice) => notice.id),
                      }),
                    },
                  ),
                ],
          ),
        );
      })().finally(() => {
        refreshing = null;
        const nextTransactionId = pendingTransactionIds.values().next().value as string | undefined;
        if (nextTransactionId) {
          pendingTransactionIds.delete(nextTransactionId);
          if (active) void refresh(nextTransactionId);
        }
      });
      return refreshing;
    }

    const reconnect = () => void refresh();
    const unsubscribers = links.map((link) =>
      subscribeScoreStream(link.ticketId, (event) => {
        if (event.kind !== "unavailable") void refresh(event.transactionId);
      }),
    );
    void refresh();
    const fallback = window.setInterval(() => void refresh(), FALLBACK_REFRESH_MS);
    window.addEventListener("online", reconnect);
    window.addEventListener("mah-score-wake", reconnect);
    return () => {
      active = false;
      clearTimeout(dismissTimer.current);
      window.clearInterval(fallback);
      for (const unsubscribe of unsubscribers) unsubscribe();
      window.removeEventListener("online", reconnect);
      window.removeEventListener("mah-score-wake", reconnect);
    };
  }, [links, onGame, onTicket, safeGameScreen]);

  const onThings = pathname === "/things" || onGame;
  const eventLink = links.at(-1);
  const showEventNavigation = Boolean(
    eventLink && onThings && (!onGame || safeGameScreen) && celebrations.length === 0,
  );
  const showCelebration = celebrations.length > 0 && (!onGame || safeGameScreen);
  if (onTicket || (!showEventNavigation && !showCelebration)) return null;
  const confirmedBalance = celebrations.at(-1)?.balance;
  return (
    <>
      {showEventNavigation && eventLink ? (
        <nav
          aria-label="Your event"
          className="event-night-nav themed-floating-notice fixed left-3 z-30 flex min-h-11 items-center gap-1 rounded-full border p-1 font-mono text-micro"
        >
          <Link
            to="/ticket/$id"
            params={{ id: eventLink.ticketId }}
            className="themed-floating-notice-muted inline-flex min-h-11 items-center rounded-full px-3 underline underline-offset-4 hover:text-[var(--floating-notice-foreground)]"
          >
            ticket &amp; points
          </Link>
          <Link
            to="/events/$slug/score"
            params={{ slug: eventLink.eventSlug }}
            className="themed-floating-notice-muted inline-flex min-h-11 items-center rounded-full px-3 underline underline-offset-4 hover:text-[var(--floating-notice-foreground)]"
          >
            leaderboard
          </Link>
        </nav>
      ) : null}
      {showCelebration ? (
        <ScoreBalanceChange notices={celebrations} balance={confirmedBalance} />
      ) : null}
    </>
  );
}
