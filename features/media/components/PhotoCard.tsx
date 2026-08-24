import { memo, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { SelectionToggle } from "@/components/SelectionToggle";
import { AppImage } from "@/components/AppImage";
import { getAlbumImageData } from "@/features/media/storage";
import { imagePlaceholderStyle } from "@/features/media/image";
import type { Photo } from "@/features/media/albums";

type PhotoCardProps = {
  albumSlug: string;
  photo: Photo;
  alt: string;
  priority?: boolean;
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
  photo,
  alt,
  priority,
  selectable,
  selected,
  onSelect,
}: PhotoCardProps) {
  const image = getAlbumImageData(albumSlug, photo);

  const handleSelect = useCallback(
    (e: React.MouseEvent) => {
      if (selectable) {
        e.preventDefault();
        onSelect?.(photo.id);
      }
    },
    [selectable, onSelect, photo.id],
  );

  const aspectRatio = photo.height / photo.width;

  return (
    <div className="gallery-card group">
      <Link
        to="/pics/$album/$photo"
        params={{ album: albumSlug, photo: photo.id }}
        className="media-image-placeholder block relative overflow-hidden rounded-sm"
        style={{
          paddingBottom: `${aspectRatio * 100}%`,
          ...imagePlaceholderStyle(photo.placeholder),
        }}
        onClick={handleSelect}
      >
        <AppImage
          src={image.src}
          srcSet={image.srcSet}
          sources={image.sources}
          alt={alt}
          width={photo.width}
          height={photo.height}
          reveal
          priority={priority}
          sizes="(min-width: 768px) 33vw, 50vw"
          className="absolute inset-0 h-full w-full object-cover"
        />

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-200" />

        {/* Selection toggle */}
        {selectable && (
          <div className="absolute top-2 right-2 z-10">
            <SelectionToggle
              selected={!!selected}
              onToggle={() => onSelect?.(photo.id)}
              variant="overlay"
            />
          </div>
        )}
      </Link>
    </div>
  );
});
