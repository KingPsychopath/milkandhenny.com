import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";

import { getClaimedScoreLinksFn } from "../public.functions";
import { hasRememberedScoreSession } from "../client-sync";
import { SAFE_GAME_NAVIGATION_EVENT } from "@/features/things/shared/useSafeGameNavigation";

export function ClaimedScoreLinks() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [links, setLinks] = useState<Array<{ eventSlug: string; ticketId: string }>>([]);
  const [safeGameScreen, setSafeGameScreen] = useState(false);
  const [notices, setNotices] = useState<
    Array<{ id: string; ticketId: string; points: number; kind: string; createdAt: string }>
  >([]);
  useEffect(() => {
    const game = pathname.startsWith("/things/");
    const update = (event?: Event) => {
      const safe =
        event instanceof CustomEvent && typeof event.detail?.safe === "boolean"
          ? event.detail.safe
          : document.documentElement.dataset.gameSafeNavigation === "true";
      setSafeGameScreen(safe);
      if ((!game || safe) && hasRememberedScoreSession()) {
        void getClaimedScoreLinksFn()
          .then(setLinks)
          .catch(() => undefined);
      }
    };
    update();
    window.addEventListener(SAFE_GAME_NAVIGATION_EVENT, update);
    return () => window.removeEventListener(SAFE_GAME_NAVIGATION_EVENT, update);
  }, [pathname]);
  const onGame = pathname.startsWith("/things/");
  useEffect(() => {
    if (links.length === 0 || (onGame && !safeGameScreen)) return;
    let active = true;
    async function refresh() {
      const batches = await Promise.all(
        links.map(async (link) => {
          const ticketId = encodeURIComponent(link.ticketId);
          const noticeResponse = await fetch(`/api/tickets/${ticketId}/score/notifications`, {
            headers: { accept: "application/json" },
          });
          const body = noticeResponse.ok
            ? ((await noticeResponse.json()) as {
                notifications?: Array<{
                  id: string;
                  points: number;
                  kind: string;
                  createdAt: string;
                }>;
              })
            : undefined;
          return {
            link,
            notifications: body?.notifications ?? [],
          };
        }),
      );
      if (!active) return;
      const ordered = batches
        .flatMap((batch) =>
          batch.notifications.map((notice) => ({ ...notice, ticketId: batch.link.ticketId })),
        )
        .sort(
          (left, right) =>
            Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
            left.id.localeCompare(right.id),
        );
      setNotices(ordered.slice(-3));
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
    }
    const reconnect = () => void refresh();
    void refresh();
    window.addEventListener("online", reconnect);
    window.addEventListener("mah-score-wake", reconnect);
    return () => {
      active = false;
      window.removeEventListener("online", reconnect);
      window.removeEventListener("mah-score-wake", reconnect);
    };
  }, [links, onGame, safeGameScreen]);
  if (notices.length === 0 || (onGame && !safeGameScreen)) return null;
  return (
    <aside
      aria-label="Score updates"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-30 border theme-border bg-background px-3 py-2 shadow-sm"
    >
      {notices.map((notice) => (
        <p key={notice.id} className="font-mono text-micro">
          {notice.kind === "held"
            ? `${Math.abs(notice.points)} points pending review`
            : `${notice.points > 0 ? "+" : ""}${notice.points} confirmed points`}
        </p>
      ))}
    </aside>
  );
}
