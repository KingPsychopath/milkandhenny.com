import { useCallback, useEffect, useRef } from "react";

interface RoomReconcilerOptions {
  enabled: boolean;
  intervalMs: number;
  roomKey: string | null;
  reconcile: (isCurrent: () => boolean) => Promise<void>;
}

/** Coalesces socket wakes, safety polling, online events, and tab resumes into one request. */
export function useRoomReconciler({ enabled, intervalMs, roomKey, reconcile }: RoomReconcilerOptions) {
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

    const run = async () => {
      if (!active) return;
      if (inFlight) {
        rerun = true;
        return new Promise<void>((resolve) => waiters.push(resolve));
      }
      inFlight = true;
      try {
        await reconcileRef.current(() => active);
      } finally {
        inFlight = false;
        if (rerun && active) {
          rerun = false;
          await run();
        }
        if (!inFlight) {
          const currentWaiters = waiters;
          waiters = [];
          currentWaiters.forEach((resolve) => resolve());
        }
      }
    };

    const resume = () => void run();
    runRef.current = run;
    void run();
    const interval = window.setInterval(resume, intervalMs);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      active = false;
      runRef.current = null;
      waiters.forEach((resolve) => resolve());
      waiters = [];
      window.clearInterval(interval);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [enabled, intervalMs, roomKey]);

  return useCallback(() => runRef.current?.() ?? Promise.resolve(), []);
}
