"use client";

import { useRef, useState, useEffect, useCallback } from "react";

type UseLazyImageOptions = {
  /** Pixel margin around the viewport to start loading early */
  rootMargin?: string;
};

/**
 * Lazy-loads an image via IntersectionObserver and tracks load/error state.
 * Provides a consistent fade-in pattern across all gallery-style components.
 *
 * @param src - The image URL to lazy-load
 * @param options - IntersectionObserver options
 * @returns ref to attach to the `<img>`, plus loaded/errored booleans
 */
function useLazyImage(src: string, options?: UseLazyImageOptions) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  const handleLoad = useCallback(() => setLoaded(true), []);
  const handleError = useCallback(() => setErrored(true), []);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    // Reset state when src changes
    setLoaded(false);
    setErrored(false);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          img.src = src;
          observer.disconnect();
        }
      },
      { rootMargin: options?.rootMargin ?? "200px" }
    );

    observer.observe(img);
    return () => observer.disconnect();
  }, [src, options?.rootMargin]);

  return { imgRef, loaded, errored, handleLoad, handleError } as const;
}

export { useLazyImage };
