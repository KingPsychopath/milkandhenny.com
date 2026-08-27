import { useCallback, useEffect, useRef } from "react";

interface VisibilityReconcilerOptions {
  enabled: boolean;
  intervalMs: number;
  identity: string | null;
  minimumGapMs?: number;
  reconcileOnEnable?: boolean;
  reconcile: (isCurrent: () => boolean) => Promise<void>;
}

/** Coalesces safety refreshes, online events, and tab resumes into one visible-tab request. */
export function useVisibilityReconciler({
  enabled,
  intervalMs,
  identity,
  minimumGapMs = 0,
  reconcileOnEnable = true,
  reconcile,
}: VisibilityReconcilerOptions) {
  const reconcileRef = useRef(reconcile);
  const runRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    reconcileRef.current = reconcile;
  }, [reconcile]);

  useEffect(() => {
    if (!enabled) {
      runRef.current = null;
      return;
    }

    let active = true;
    let inFlight = false;
    let rerun = false;
    let waiters: Array<() => void> = [];
    let lastCompletedAt = Number.NEGATIVE_INFINITY;
    let cooldownTimer: number | null = null;
    let safetyTimer: number | null = null;
    let scheduled = false;

    const isVisible = () => document.visibilityState !== "hidden";
    const resolveWaiters = () => {
      if (inFlight || rerun || scheduled) return;
      const currentWaiters = waiters;
      waiters = [];
      currentWaiters.forEach((resolve) => resolve());
    };
    const clearSafetyTimer = () => {
      if (safetyTimer !== null) window.clearTimeout(safetyTimer);
      safetyTimer = null;
    };
    const pause = () => {
      clearSafetyTimer();
      if (cooldownTimer !== null) window.clearTimeout(cooldownTimer);
      cooldownTimer = null;
      scheduled = false;
      rerun = false;
      resolveWaiters();
    };
    const schedule = (delayMs: number) => {
      if (!active || !isVisible() || cooldownTimer !== null) return;
      scheduled = true;
      cooldownTimer = window.setTimeout(
        () => {
          cooldownTimer = null;
          scheduled = false;
          void run().catch(() => undefined);
        },
        Math.max(0, delayMs),
      );
    };
    const scheduleSafety = () => {
      if (!active || !isVisible() || safetyTimer !== null) return;
      safetyTimer = window.setTimeout(
        () => {
          safetyTimer = null;
          trigger();
          scheduleSafety();
        },
        Math.max(1, intervalMs),
      );
    };
    const run = async () => {
      if (!active || !isVisible()) return;
      if (inFlight) {
        rerun = true;
        return new Promise<void>((resolve) => waiters.push(resolve));
      }
      const remainingGap = minimumGapMs - (Date.now() - lastCompletedAt);
      if (remainingGap > 0) {
        rerun = true;
        schedule(remainingGap);
        return new Promise<void>((resolve) => waiters.push(resolve));
      }

      inFlight = true;
      try {
        await reconcileRef.current(() => active);
      } finally {
        lastCompletedAt = Date.now();
        inFlight = false;
        if (rerun && active && isVisible()) {
          rerun = false;
          schedule(minimumGapMs);
        } else if (!isVisible()) {
          rerun = false;
        }
        resolveWaiters();
      }
    };
    const trigger = () => {
      if (!active || !isVisible()) return;
      void run().catch(() => undefined);
    };
    const resume = () => {
      if (!isVisible()) {
        pause();
        return;
      }
      trigger();
      scheduleSafety();
    };

    runRef.current = run;
    if (reconcileOnEnable) trigger();
    scheduleSafety();
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);

    return () => {
      active = false;
      runRef.current = null;
      pause();
      waiters.forEach((resolve) => resolve());
      waiters = [];
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [enabled, identity, intervalMs, minimumGapMs, reconcileOnEnable]);

  return useCallback(() => runRef.current?.() ?? Promise.resolve(), []);
}
