"use client";

import { memo, useCallback } from "react";
import Link from "next/link";
import { useLazyImage } from "@/hooks/useLazyImage";
import { SelectionToggle } from "@/components/SelectionToggle";

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
 * Uses native `loading="lazy"` + `decoding="async"` — the browser handles
 * viewport-based loading with smart heuristics (connection speed, data saver,
 * distance from viewport) which outperforms a manual IntersectionObserver
 * at scale (100+ photos per album).
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
  const { loaded, errored, handleLoad, handleError } = useLazyImage();

  const handleSelect = useCallback(
    (e: React.MouseEvent) => {
      if (selectable) {
        e.preventDefault();
        onSelect?.(photoId);
      }
    },
    [selectable, onSelect, photoId]
  );

  const aspectRatio = height / width;

  return (
    <div className="gallery-card group">
      <Link
        href={`/pics/${albumSlug}/${photoId}`}
        className="block relative overflow-hidden rounded-sm"
        style={{ paddingBottom: `${aspectRatio * 100}%` }}
        onClick={handleSelect}
      >
        {/* Placeholder — uses blur data URI when available */}
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
            src={thumbUrl}
            alt={`Photo ${photoId} from album`}
            width={width}
            height={height}
            loading="lazy"
            decoding="async"
            sizes="(min-width: 768px) 33vw, 50vw"
            onLoad={handleLoad}
            onError={handleError}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
              loaded ? "opacity-100" : "opacity-0"
            }`}
          />
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-200" />

        {/* Selection toggle */}
        {selectable && (
          <div className="absolute top-2 right-2 z-10">
            <SelectionToggle
              selected={!!selected}
              onToggle={() => onSelect?.(photoId)}
              variant="overlay"
            />
          </div>
        )}
      </Link>
    </div>
  );
});
