"use client";

import Link from "next/link";
import { memo } from "react";
import { getThumbUrl } from "@/lib/media/storage";
import { useLazyImage } from "@/hooks/useLazyImage";

/** Serializable album data passed from the server page */
type EmbeddedAlbum = {
  slug: string;
  title: string;
  date: string;
  cover: string;
  photoCount: number;
  /** First 6 photo IDs (cover first, then others) — compact uses 4, masonry uses 6 */
  previewIds: string[];
  /** Pre-resolved CSS object-position per photo ID (from manual preset or auto-detected face) */
  focalPoints?: Record<string, string>;
};

/** Which visual variant to render */
type EmbedVariant = "compact" | "masonry";

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/* ─── Fill thumbnail (absolute-positioned, fills parent cell) ─── */

const FillThumb = memo(function FillThumb({
  slug,
  photoId,
  objectPosition,
}: {
  slug: string;
  photoId: string;
  objectPosition?: string;
}) {
  const thumbUrl = getThumbUrl(slug, photoId);
  const { loaded, errored, handleLoad, handleError } = useLazyImage();

  if (errored) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumbUrl}
      alt=""
      loading="lazy"
      decoding="async"
      onLoad={handleLoad}
      onError={handleError}
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
        transition: "opacity 0.3s ease",
        opacity: loaded ? 1 : 0,
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
  if (!album?.slug || !album?.title || !album?.previewIds?.length) return null;

  const ids = album.previewIds.slice(0, COMPACT_PREVIEW_LIMIT);
  const remaining = album.photoCount - ids.length;
  const showOverlay = remaining > 0;

  return (
    <Link href={`/pics/${album.slug}`} className="album-embed">
      <div className="album-embed-strip">
        {ids.map((id, i) => (
          <div key={id} className="album-embed-thumb">
            <FillThumb
              slug={album.slug}
              photoId={id}
              objectPosition={album.focalPoints?.[id]}
            />
            {showOverlay && i === ids.length - 1 && (
              <div className="album-embed-thumb-overlay">
                <span className="font-mono text-xs text-white/90 tracking-wide">
                  +{remaining}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="album-embed-meta">
        <p className="album-embed-title">{album.title}</p>
        <p className="album-embed-detail">
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
  if (!album?.slug || !album?.title || !album?.previewIds?.length) return null;

  const ids = album.previewIds.slice(0, MASONRY_PREVIEW_LIMIT);
  const remaining = album.photoCount - ids.length;
  const showOverlay = remaining > 0;

  return (
    <div className="album-embed-masonry">
      <Link href={`/pics/${album.slug}`} className="album-embed-masonry-grid">
        {ids.map((id, i) => {
          const isLast = i === ids.length - 1;
          const objectPosition = album.focalPoints?.[id];
          return (
            <div key={id} className="album-embed-masonry-tile">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getThumbUrl(album.slug, id)}
                alt=""
                loading="lazy"
                style={
                  objectPosition
                    ? { objectFit: "cover", objectPosition }
                    : undefined
                }
                onError={(e) => {
                  (e.currentTarget.parentElement as HTMLElement).style.display = "none";
                }}
              />
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
      <Link href={`/pics/${album.slug}`} className="album-embed-masonry-meta">
        <p className="album-embed-title">{album.title}</p>
        <p className="album-embed-detail">
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
