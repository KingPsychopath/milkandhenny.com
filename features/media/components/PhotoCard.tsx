import { memo } from "react";
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

  const aspectRatio = photo.height / photo.width;

  return (
    <div
      className="gallery-card group media-image-placeholder relative overflow-hidden rounded-sm"
      style={{
        paddingBottom: `${aspectRatio * 100}%`,
        ...imagePlaceholderStyle(photo.placeholder),
      }}
    >
      {selectable ? (
        <SelectionToggle
          selected={!!selected}
          onToggle={() => onSelect?.(photo.id)}
          ariaLabel={`${selected ? "Deselect" : "Select"} ${alt}`}
          fullSurface
          variant="overlay"
          className="z-10 cursor-pointer"
        />
      ) : (
        <Link
          to="/pics/$album/$photo"
          params={{ album: albumSlug, photo: photo.id }}
          className="absolute inset-0 z-[1] block"
          aria-label={`Open ${alt}`}
        />
      )}

      <div className="absolute inset-0">
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
      </div>
    </div>
  );
});
