"use client";

import { Link } from "@tanstack/react-router";
import { memo } from "react";
import { AppImage } from "@/components/AppImage";
import { getAlbumImageData } from "@/features/media/storage";
import { imagePlaceholderStyle } from "@/features/media/image";
import type { Photo } from "@/features/media/albums";

/** Serializable album data passed from the server page */
type EmbeddedAlbum = {
  slug: string;
  title: string;
  date: string;
  cover: string;
  photoCount: number;
  /** First 6 photos (cover first, then others) — compact uses 4, masonry uses 6 */
  previewPhotos: Photo[];
  /** Pre-resolved CSS object-position per photo ID (from manual preset or auto-detected face) */
  focalPoints?: Record<string, string>;
};

/** Which visual variant to render */
type EmbedVariant = "compact" | "masonry";

function formatDate(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/* ─── Fill thumbnail (absolute-positioned, fills parent cell) ─── */

const FillThumb = memo(function FillThumb({
  slug,
  photo,
  objectPosition,
}: {
  slug: string;
  photo: Photo;
  objectPosition?: string;
}) {
  const image = getAlbumImageData(slug, photo);

  return (
    <AppImage
      src={image.src}
      srcSet={image.srcSet}
      sources={image.sources}
      alt=""
      width={photo.width}
      height={photo.height}
      reveal
      sizes="(min-width: 672px) 156px, 25vw"
      className="album-embed-thumb-img"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: objectPosition ?? "center",
        margin: 0,
        borderRadius: 0,
      }}
    />
  );
});

const MasonryThumb = memo(function MasonryThumb({
  slug,
  photo,
  objectPosition,
}: {
  slug: string;
  photo: Photo;
  objectPosition?: string;
}) {
  const image = getAlbumImageData(slug, photo);

  return (
    <AppImage
      src={image.src}
      srcSet={image.srcSet}
      sources={image.sources}
      alt=""
      width={photo.width}
      height={photo.height}
      reveal
      sizes="(min-width: 672px) 306px, 50vw"
      className="album-embed-masonry-img"
      style={{
        objectFit: "cover",
        objectPosition: objectPosition ?? "center",
      }}
    />
  );
});

const COMPACT_PREVIEW_LIMIT = 4;
const MASONRY_PREVIEW_LIMIT = 6;

/* ════════════════════════════════════════════════════════════════════
 *  COMPACT — Thumbnail strip (4 thumbs at 4:3 + meta below)
 * ════════════════════════════════════════════════════════════════════ */

function AlbumEmbedCompact({ album }: { album: EmbeddedAlbum }) {
  if (!album?.slug || !album?.title || !album?.previewPhotos?.length) return null;

  const photos = album.previewPhotos.slice(0, COMPACT_PREVIEW_LIMIT);
  const remaining = album.photoCount - photos.length;
  const showOverlay = remaining > 0;

  return (
    <Link
      to="/pics/$album"
      params={{ album: album.slug }}
      className="album-embed"
      aria-label={`View album: ${album.title}`}
    >
      <div className="album-embed-strip">
        {photos.map((photo, i) => (
          <div
            key={photo.id}
            className="media-image-placeholder album-embed-thumb"
            style={imagePlaceholderStyle(photo.placeholder)}
          >
            <FillThumb
              slug={album.slug}
              photo={photo}
              objectPosition={album.focalPoints?.[photo.id]}
            />
            {showOverlay && i === photos.length - 1 && (
              <div className="album-embed-thumb-overlay">
                <span className="font-mono text-xs text-white/90 tracking-wide">+{remaining}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="album-embed-meta">
        <p className="album-embed-title font-serif">{album.title}</p>
        <p className="album-embed-detail font-mono">
          {formatDate(album.date)} · {album.photoCount}{" "}
          {album.photoCount === 1 ? "photo" : "photos"}
        </p>
      </div>
    </Link>
  );
}

/* ════════════════════════════════════════════════════════════════════
 *  MASONRY — Free-flowing Pinterest-style column tiles
 *  Not contained in a card box — each thumbnail is its own tile.
 * ════════════════════════════════════════════════════════════════════ */

function AlbumEmbedMasonry({ album }: { album: EmbeddedAlbum }) {
  if (!album?.slug || !album?.title || !album?.previewPhotos?.length) return null;

  const photos = album.previewPhotos.slice(0, MASONRY_PREVIEW_LIMIT);
  const remaining = album.photoCount - photos.length;
  const showOverlay = remaining > 0;

  return (
    <div className="album-embed-masonry">
      <Link
        to="/pics/$album"
        params={{ album: album.slug }}
        className="album-embed-masonry-grid"
        aria-label={`View album: ${album.title}`}
      >
        {photos.map((photo, i) => {
          const isLast = i === photos.length - 1;
          const objectPosition = album.focalPoints?.[photo.id];
          return (
            <div
              key={photo.id}
              className="media-image-placeholder album-embed-masonry-tile"
              style={imagePlaceholderStyle(photo.placeholder)}
            >
              <MasonryThumb slug={album.slug} photo={photo} objectPosition={objectPosition} />
              {showOverlay && isLast && (
                <div className="album-embed-masonry-overlay">
                  <span className="font-mono text-xs text-white/90 tracking-wide">
                    +{remaining}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </Link>
      <Link to="/pics/$album" params={{ album: album.slug }} className="album-embed-masonry-meta">
        <p className="album-embed-title font-serif">{album.title}</p>
        <p className="album-embed-detail font-mono">
          {formatDate(album.date)} · {album.photoCount}{" "}
          {album.photoCount === 1 ? "photo" : "photos"}
        </p>
      </Link>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
 *  Router — picks variant based on the `variant` prop.
 *  Default: "compact". Use #masonry in the markdown URL hash to
 *  trigger the masonry layout.
 * ════════════════════════════════════════════════════════════════════ */

function AlbumEmbed({
  album,
  variant = "compact",
}: {
  album: EmbeddedAlbum;
  variant?: EmbedVariant;
}) {
  if (!album?.slug || !album?.title) return null;

  if (variant === "masonry") return <AlbumEmbedMasonry album={album} />;
  return <AlbumEmbedCompact album={album} />;
}

export { AlbumEmbed, AlbumEmbedCompact, AlbumEmbedMasonry };
export type { EmbeddedAlbum, EmbedVariant };
