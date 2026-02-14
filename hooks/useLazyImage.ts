"use client";

import { useState, useCallback } from "react";

/**
 * Tracks image load/error state for fade-in patterns.
 *
 * Returns a callback ref (`imgRef`) that must be placed on the `<img>` element.
 * This detects images already loaded from browser cache on mount — without it,
 * cached images miss the `onLoad` event and stay invisible (`opacity-0`) forever.
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

  /** Callback ref — catches images that resolved from cache before onLoad was attached */
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) {
      setLoaded(true);
    }
  }, []);

  return { loaded, errored, handleLoad, handleError, imgRef } as const;
}

export { useLazyImage };
