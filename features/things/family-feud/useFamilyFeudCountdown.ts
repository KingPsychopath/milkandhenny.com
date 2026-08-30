import { useEffect, useState } from "react";

export function useFamilyFeudCountdown(endsAt: number, serverOffset: number, paused: boolean) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const update = () =>
      setRemaining(
        paused || endsAt <= 0
          ? 0
          : Math.max(0, Math.ceil((endsAt - Date.now() - serverOffset) / 1_000)),
      );
    update();
    const timer = window.setInterval(update, 200);
    return () => window.clearInterval(timer);
  }, [endsAt, paused, serverOffset]);
  return remaining;
}
