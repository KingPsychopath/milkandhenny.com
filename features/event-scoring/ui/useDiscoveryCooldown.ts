import { useCallback, useEffect, useState } from "react";

export function formatDiscoveryCooldown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function useDiscoveryCooldown() {
  const [deadline, setDeadline] = useState<number>();
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  useEffect(() => {
    if (deadline === undefined) {
      setRemainingSeconds(0);
      return;
    }
    const update = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining === 0) setDeadline(undefined);
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [deadline]);

  const startCooldown = useCallback((seconds: number | undefined) => {
    if (!Number.isFinite(seconds) || !seconds || seconds <= 0) return;
    setDeadline(Date.now() + Math.ceil(seconds) * 1000);
  }, []);
  const clearCooldown = useCallback(() => setDeadline(undefined), []);

  return {
    clearCooldown,
    coolingDown: remainingSeconds > 0,
    remainingSeconds,
    startCooldown,
  };
}
