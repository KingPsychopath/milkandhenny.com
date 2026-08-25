import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";

import { getClaimedScoreLinksFn } from "../public.functions";

export function ClaimedScoreLinks() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [links, setLinks] = useState<Array<{ eventSlug: string; ticketId: string }>>([]);
  useEffect(() => {
    void getClaimedScoreLinksFn()
      .then(setLinks)
      .catch(() => undefined);
  }, []);
  if (links.length === 0 || pathname.startsWith("/things/")) return null;
  return (
    <nav
      aria-label="Claimed event scores"
      className="fixed bottom-4 left-4 z-30 border theme-border bg-background px-3 py-2 shadow-sm"
    >
      {links.length === 1 ? (
        <a
          href={`/ticket/${encodeURIComponent(links[0]!.ticketId)}`}
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
