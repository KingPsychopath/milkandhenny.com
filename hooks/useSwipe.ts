"use client";

import { useRef, useEffect } from "react";

type UseSwipeOptions = {
  /** Callback when user swipes left */
  onSwipeLeft?: () => void;
  /** Callback when user swipes right */
  onSwipeRight?: () => void;
  /** Minimum horizontal distance in px to count as a swipe (default 50) */
  minDistance?: number;
  /** Maximum time in ms for the gesture (default 300) */
  maxTime?: number;
  /** Maximum vertical distance in px — rejects diagonal swipes (default 80) */
  maxVertical?: number;
  /** Whether the hook is active (default true) */
  enabled?: boolean;
};

/**
 * Detects horizontal swipe gestures on a ref'd element.
 * Returns a ref to attach to the swipeable container.
 *
 * Uses callback refs internally so listeners are stable across renders —
 * the effect only re-attaches when `enabled` changes.
 *
 * @example
 * ```tsx
 * const swipeRef = useSwipe({
 *   onSwipeLeft: () => goNext(),
 *   onSwipeRight: () => goPrev(),
 * });
 * return <div ref={swipeRef}>...</div>;
 * ```
 */
function useSwipe<T extends HTMLElement = HTMLDivElement>(
  options: UseSwipeOptions
) {
  const ref = useRef<T>(null);
  const touchRef = useRef<{ x: number; y: number; time: number } | null>(null);

  // Store callbacks in refs so the effect doesn't re-attach listeners on every render
  const callbacksRef = useRef(options);
  useEffect(() => {
    callbacksRef.current = options;
  }, [options]);

  const enabled = options.enabled ?? true;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    const minDistance = callbacksRef.current.minDistance ?? 50;
    const maxTime = callbacksRef.current.maxTime ?? 300;
    const maxVertical = callbacksRef.current.maxVertical ?? 80;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      touchRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!touchRef.current) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchRef.current.x;
      const dy = touch.clientY - touchRef.current.y;
      const dt = Date.now() - touchRef.current.time;
      touchRef.current = null;

      // Must be fast, horizontal, and long enough
      if (dt > maxTime || Math.abs(dy) > maxVertical || Math.abs(dx) < minDistance)
        return;

      if (dx < 0) callbacksRef.current.onSwipeLeft?.();
      if (dx > 0) callbacksRef.current.onSwipeRight?.();
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [enabled]);

  return ref;
}

export { useSwipe };
export type { UseSwipeOptions };
