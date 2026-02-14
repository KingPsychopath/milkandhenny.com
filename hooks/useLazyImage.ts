"use client";

import { useState, useCallback } from "react";

/**
 * Tracks image load/error state for fade-in patterns.
 *
 * Returns a callback ref (`imgRef`) that must be placed on the `<img>` element.
 * Detects images already loaded (or failed) from browser cache on mount —
 * without this, cached images miss the `onLoad`/`onError` events and stay
 * invisible (`opacity-0`) forever.
 *
 * Pair with native `loading="lazy"` and `decoding="async"` on the `<img>`
 * element — the browser handles viewport-based loading with smart heuristics
 * (connection speed, data saver mode, distance from viewport) which
 * outperform a manual IntersectionObserver at scale (100+ images).
 */
function useLazyImage() {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  const handleLoad = useCallback(() => setLoaded(true), []);
  const handleError = useCallback(() => setErrored(true), []);

  /**
   * Callback ref — runs synchronously during commit (before paint).
   * Catches cached hits immediately. For the ambiguous `complete && naturalWidth === 0`
   * case (could be a cached error OR a deferred lazy image), we attach one-shot
   * listeners so the outcome is always captured regardless of timing.
   */
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (!img) return;

    if (img.complete) {
      if (img.naturalWidth > 0) {
        setLoaded(true);
      } else if (img.src) {
        // Ambiguous: cached error or lazy-deferred. Listen for the real outcome.
        img.addEventListener("load", () => setLoaded(true), { once: true });
        img.addEventListener("error", () => setErrored(true), { once: true });
      }
    }
  }, []);

  return { loaded, errored, handleLoad, handleError, imgRef } as const;
}

export { useLazyImage };
