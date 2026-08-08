import { useEffect, useRef, useState } from "react";

/**
 * When the cards actually appeared on *this* device.
 *
 * This is the reading the whole fairness design rests on. The server publishes an absolute reveal
 * time; every device waits for it and then marks its own first painted frame. What gets ranked is the
 * gap between that frame and the tap, so a slow connection costs a player nothing — it only delays
 * when their heat begins, equally at both ends.
 *
 * `requestAnimationFrame` rather than the timer callback: the timer fires before the browser has
 * painted, and starting the clock a frame early would quietly charge everybody 16ms.
 */
export function useTwinReveal(heatId: string | null, revealAt: number | null, clockOffset: number) {
  const [revealedAt, setRevealedAt] = useState<number | null>(null);
  const heatRef = useRef<string | null>(null);

  useEffect(() => {
    if (heatRef.current !== heatId) {
      heatRef.current = heatId;
      setRevealedAt(null);
    }
    if (!heatId || revealAt === null) return;

    let frame: number | null = null;
    const delay = Math.max(0, revealAt - (Date.now() + clockOffset));
    const timer = window.setTimeout(() => {
      frame = window.requestAnimationFrame(() => setRevealedAt(performance.now()));
    }, delay);

    return () => {
      window.clearTimeout(timer);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [clockOffset, heatId, revealAt]);

  return revealedAt;
}

/** A countdown that ticks against the server clock rather than a local one. */
export function useTwinCountdown(endsAt: number | null, clockOffset: number, active: boolean) {
  const [remainingMs, setRemainingMs] = useState(0);

  useEffect(() => {
    if (!active || endsAt === null) {
      setRemainingMs(0);
      return;
    }
    const tick = () => setRemainingMs(Math.max(0, endsAt - (Date.now() + clockOffset)));
    tick();
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [active, clockOffset, endsAt]);

  return remainingMs;
}
