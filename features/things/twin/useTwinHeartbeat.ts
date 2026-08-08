import { useEffect, useRef } from "react";
import { playTwinSound, twinHeartbeatGapMs } from "./twin-sound.client";
import { TWIN_HEARTBEAT, type TwinHeartbeatTiming } from "./twin-rules";

/**
 * The clock, felt rather than read.
 *
 * A countdown you have to look at is a countdown you are not spending on the cards, which is exactly
 * backwards for this game. The heartbeat puts the last few seconds somewhere you do not have to look:
 * silent until it matters, then closing from a resting beat to a racing one.
 *
 * It reschedules itself from the *current* remaining time rather than running on a fixed interval, so
 * the tempo tracks the clock continuously instead of stepping. Held in a ref so a re-render every
 * 100ms — which the countdown causes — does not restart the beat and stutter it.
 */
export function useTwinHeartbeat(
  remainingMs: number,
  active: boolean,
  timing: TwinHeartbeatTiming = TWIN_HEARTBEAT,
) {
  const remaining = useRef(remainingMs);
  remaining.current = remainingMs;

  useEffect(() => {
    if (!active) return;
    let timer: number | null = null;
    let stopped = false;

    const beat = () => {
      if (stopped) return;
      const gap = twinHeartbeatGapMs(remaining.current, timing);
      if (gap === null) {
        // Not urgent yet. Look again shortly rather than giving up on the heat.
        timer = window.setTimeout(beat, 200);
        return;
      }
      playTwinSound("heartbeat", true);
      timer = window.setTimeout(beat, gap);
    };

    timer = window.setTimeout(beat, 200);
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [active, timing]);
}
