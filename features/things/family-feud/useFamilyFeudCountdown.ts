import { useEffect, useState } from "react";

export function useFamilyFeudCountdown(
  endsAt: number,
  serverOffset: number,
  paused: boolean,
  pausedRemainingMs = 0,
) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const update = () =>
      setRemaining(
        paused
          ? Math.max(0, Math.ceil(pausedRemainingMs / 1_000))
          : endsAt <= 0
            ? 0
            : Math.max(0, Math.ceil((endsAt - Date.now() - serverOffset) / 1_000)),
      );
    update();
    if (paused || endsAt <= 0) return;
    const timer = window.setInterval(update, 200);
    return () => window.clearInterval(timer);
  }, [endsAt, paused, pausedRemainingMs, serverOffset]);
  return remaining;
}
