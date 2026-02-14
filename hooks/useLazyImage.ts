"use client";

import { useState, useCallback } from "react";

/**
 * Tracks image load/error state for fade-in patterns.
 *
 * Pair with native `loading="lazy"` and `decoding="async"` on the `<img>`
 * element — the browser handles viewport-based loading with smart heuristics
 * (connection speed, data saver mode, distance from viewport) which
 * outperform a manual IntersectionObserver at scale (100+ images).
 *
 * @param _src - Image URL (reserved for future srcset support; currently unused)
 * @returns loaded/errored booleans + stable onLoad/onError handlers
 */
function useLazyImage(_src?: string) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  const handleLoad = useCallback(() => setLoaded(true), []);
  const handleError = useCallback(() => setErrored(true), []);

  return { loaded, errored, handleLoad, handleError } as const;
}

export { useLazyImage };
