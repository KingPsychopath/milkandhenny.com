import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";

import { getClaimedScoreLinksFn } from "../public.functions";
import { SAFE_GAME_NAVIGATION_EVENT } from "@/features/things/shared/useSafeGameNavigation";

export function ClaimedScoreLinks() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [links, setLinks] = useState<Array<{ eventSlug: string; ticketId: string }>>([]);
  const [safeGameScreen, setSafeGameScreen] = useState(false);
  useEffect(() => {
    const game = pathname.startsWith("/things/");
    const update = (event?: Event) => {
      const safe =
        event instanceof CustomEvent && typeof event.detail?.safe === "boolean"
          ? event.detail.safe
          : document.documentElement.dataset.gameSafeNavigation === "true";
      setSafeGameScreen(safe);
      if ((!game || safe) && localStorage.getItem("mah-has-score-session") === "1") {
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
  if (links.length === 0 || (onGame && !safeGameScreen)) return null;
  return (
    <nav
      aria-label="Claimed event scores"
      className="fixed bottom-4 left-4 z-30 border theme-border bg-background px-3 py-2 shadow-sm"
    >
      {links.length === 1 ? (
        <a
          href={`/ticket/${encodeURIComponent(links[0]!.ticketId)}`}
          target={onGame ? "_blank" : undefined}
          rel={onGame ? "noreferrer" : undefined}
          className="font-mono text-micro underline hover:opacity-70"
        >
          ticket and score
        </a>
      ) : (
        <details>
          <summary className="min-h-11 cursor-pointer py-3 font-mono text-micro underline">
            my events
          </summary>
          <ul className="space-y-2 pb-2">
            {links.map((link) => (
              <li key={link.eventSlug}>
                <a
                  href={`/ticket/${encodeURIComponent(link.ticketId)}`}
                  target={onGame ? "_blank" : undefined}
                  rel={onGame ? "noreferrer" : undefined}
                  className="font-mono text-micro underline hover:opacity-70"
                >
                  {link.eventSlug.replaceAll("-", " ")}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </nav>
  );
}
