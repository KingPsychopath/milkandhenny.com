import { useEffect, useState } from "react";

import { PixelWorld } from "./PixelWorld";

const FOOTER_VISITOR_SEEN = "milk-and-henny:footer-visitor-seen";
const IDLE_MINIMUM_MS = 30_000;
const IDLE_VARIANCE_MS = 15_000;
const VISIT_DURATION_MS = 12_000;

export function LostGuest404() {
  return (
    <div className="lost-guest-404" aria-hidden="true">
      <PixelWorld
        decorative
        room={{
          game: "lost",
          roomId: "lost-guest-404",
          status: "waiting",
          capacity: 1,
          players: [
            {
              id: "lost-guest-404",
              name: "lost guest",
              ready: false,
              role: "lost-guest",
            },
          ],
        }}
        label=""
      />
    </div>
  );
}

export function HomepageFooterVisitor() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches || sessionStorage.getItem(FOOTER_VISITOR_SEEN)) return;

    let idleTimer = 0;
    let departureTimer = 0;
    let shown = false;
    const schedule = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(
        () => {
          shown = true;
          sessionStorage.setItem(FOOTER_VISITOR_SEEN, "1");
          setVisible(true);
          departureTimer = window.setTimeout(() => setVisible(false), VISIT_DURATION_MS);
        },
        IDLE_MINIMUM_MS + Math.floor(Math.random() * IDLE_VARIANCE_MS),
      );
    };
    const activity = () => {
      if (!shown) schedule();
    };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "scroll", "touchstart"];
    events.forEach((event) => window.addEventListener(event, activity, { passive: true }));
    schedule();
    return () => {
      window.clearTimeout(idleTimer);
      window.clearTimeout(departureTimer);
      events.forEach((event) => window.removeEventListener(event, activity));
    };
  }, []);

  if (!visible) return null;
  return (
    <div className="homepage-footer-visitor" aria-hidden="true">
      <PixelWorld
        decorative
        room={{
          game: "hotel",
          roomId: "homepage-footer-visitor",
          status: "waiting",
          capacity: 1,
          players: [
            {
              id: "homepage-footer-visitor",
              name: "passing guest",
              ready: false,
              role: "passerby",
            },
          ],
        }}
        label=""
      />
    </div>
  );
}
