import { useEffect } from "react";

/**
 * Holds the screen awake while a game is actually being played — forehead in particular, where the
 * phone sits on someone's head untouched for a whole round and would otherwise dim and lock.
 *
 * iOS Safari has supported this since 16.4; anywhere without it simply carries on as before. The
 * lock is dropped by the browser whenever the tab is hidden, so it has to be taken again on the way
 * back rather than acquired once.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.wakeLock) return;
    let released = false;
    let sentinel: WakeLockSentinel | null = null;

    const acquire = async () => {
      if (released || document.visibilityState !== "visible" || sentinel) return;
      try {
        const next = await navigator.wakeLock!.request("screen");
        if (released) {
          void next.release().catch(() => undefined);
          return;
        }
        sentinel = next;
        // Low battery and other browser-side reasons can drop it without the tab ever hiding.
        next.addEventListener("release", () => {
          if (sentinel === next) sentinel = null;
        });
      } catch {
        // Denied by the browser (low power mode, permissions policy). The game still plays.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
  }, [active]);
}
