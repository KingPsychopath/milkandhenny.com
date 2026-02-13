"use client";

import { useRef, useEffect, useState, memo, useCallback } from "react";
import Link from "next/link";

type PhotoCardProps = {
  albumSlug: string;
  photoId: string;
  thumbUrl: string;
  width: number;
  height: number;
  blur?: string;
  /** Whether multi-select mode is active */
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (photoId: string) => void;
};

/**
 * A single photo in the gallery grid.
 * Lazy-loads with intersection observer and shows a placeholder until ready.
 * Memoized to prevent re-renders when sibling cards change selection state.
 */
export const PhotoCard = memo(function PhotoCard({
  albumSlug,
  photoId,
  thumbUrl,
  width,
  height,
  blur,
  selectable,
  selected,
  onSelect,
}: PhotoCardProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  const handleLoad = useCallback(() => setLoaded(true), []);
  const handleError = useCallback(() => setErrored(true), []);
  const handleSelect = useCallback(
    (e: React.MouseEvent) => {
      if (selectable) {
        e.preventDefault();
        onSelect?.(photoId);
      }
    },
    [selectable, onSelect, photoId]
  );

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          img.src = thumbUrl;
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(img);
    return () => observer.disconnect();
  }, [thumbUrl]);

  const aspectRatio = height / width;

  return (
    <div className="gallery-card group">
      <Link
        href={`/pics/${albumSlug}/${photoId}`}
        className="block relative overflow-hidden rounded-sm"
        style={{ paddingBottom: `${aspectRatio * 100}%` }}
        onClick={handleSelect}
      >
        {/* Placeholder */}
        <div
          className="absolute inset-0 gallery-placeholder"
          style={
            blur
              ? { backgroundImage: `url(${blur})`, backgroundSize: "cover" }
              : undefined
          }
        />

        {/* Image — hidden if it fails to load, leaving the placeholder visible */}
        {!errored && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            alt={`Photo ${photoId} from album`}
            width={width}
            height={height}
            onLoad={handleLoad}
            onError={handleError}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
              loaded ? "opacity-100" : "opacity-0"
            }`}
          />
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-200" />

        {/* Selection checkbox */}
        {selectable && (
          <div
            className={`absolute top-2 right-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
              selected
                ? "bg-amber-500 border-amber-500"
                : "border-white/70 bg-black/20"
            }`}
          >
            {selected && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
        )}
      </Link>
    </div>
  );
});
