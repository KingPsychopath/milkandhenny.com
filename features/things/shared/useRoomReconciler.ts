import { useCallback, useEffect, useRef } from "react";
import { MULTIPLAYER_REALTIME_LIMITS } from "./multiplayer-realtime";

interface RoomReconcilerOptions {
  enabled: boolean;
  intervalMs: number;
  roomKey: string | null;
  reconcile: (isCurrent: () => boolean) => Promise<void>;
}

/** Coalesces socket wakes, safety polling, online events, and tab resumes into one request. */
export function useRoomReconciler({
  enabled,
  intervalMs,
  roomKey,
  reconcile,
}: RoomReconcilerOptions) {
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
    let scheduled = false;

    const resolveWaiters = () => {
      if (inFlight || rerun || scheduled) return;
      const currentWaiters = waiters;
      waiters = [];
      currentWaiters.forEach((resolve) => resolve());
    };

    const schedule = (delayMs: number) => {
      if (!active || cooldownTimer !== null) return;
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

    const run = async () => {
      if (!active) return;
      if (inFlight) {
        rerun = true;
        return new Promise<void>((resolve) => waiters.push(resolve));
      }
      const remainingGap =
        MULTIPLAYER_REALTIME_LIMITS.minimumReconciliationGapMs - (Date.now() - lastCompletedAt);
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
        if (rerun && active) {
          rerun = false;
          schedule(MULTIPLAYER_REALTIME_LIMITS.minimumReconciliationGapMs);
        }
        resolveWaiters();
      }
    };

    const trigger = () => void run().catch(() => undefined);
    const resume = () => {
      if (document.visibilityState !== "hidden") trigger();
    };
    runRef.current = run;
    trigger();
    const interval = window.setInterval(resume, intervalMs);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      active = false;
      runRef.current = null;
      if (cooldownTimer !== null) window.clearTimeout(cooldownTimer);
      cooldownTimer = null;
      scheduled = false;
      rerun = false;
      waiters.forEach((resolve) => resolve());
      waiters = [];
      window.clearInterval(interval);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [enabled, intervalMs, roomKey]);

  return useCallback(() => runRef.current?.() ?? Promise.resolve(), []);
}
