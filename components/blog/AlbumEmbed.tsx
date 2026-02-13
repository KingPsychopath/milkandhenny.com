"use client";

import Link from "next/link";
import { useRef, useState, useEffect, memo } from "react";
import { getThumbUrl } from "@/lib/storage";

/** Serializable album data passed from the server page */
type EmbeddedAlbum = {
  slug: string;
  title: string;
  date: string;
  cover: string;
  photoCount: number;
  /** First 4 photo IDs (cover first, then others) for the preview strip */
  previewIds: string[];
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
}: {
  slug: string;
  photoId: string;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const thumbUrl = getThumbUrl(slug, photoId);

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

  if (errored) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      alt=""
      onLoad={() => setLoaded(true)}
      onError={() => setErrored(true)}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        margin: 0,
        borderRadius: 0,
        transition: "opacity 0.3s ease",
        opacity: loaded ? 1 : 0,
      }}
    />
  );
});

/* ════════════════════════════════════════════════════════════════════
 *  COMPACT — Thumbnail strip (4 thumbs at 4:3 + meta below)
 * ════════════════════════════════════════════════════════════════════ */

function AlbumEmbedCompact({ album }: { album: EmbeddedAlbum }) {
  if (!album?.slug || !album?.title || !album?.previewIds?.length) return null;

  const remaining = album.photoCount - album.previewIds.length;
  const showOverlay = remaining > 0;

  return (
    <Link href={`/pics/${album.slug}`} className="album-embed">
      <div className="album-embed-strip">
        {album.previewIds.map((id, i) => (
          <div key={id} className="album-embed-thumb">
            <FillThumb slug={album.slug} photoId={id} />
            {showOverlay && i === album.previewIds.length - 1 && (
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

  const remaining = album.photoCount - album.previewIds.length;
  const showOverlay = remaining > 0;
  const ids = album.previewIds;

  return (
    <div className="album-embed-masonry">
      <Link href={`/pics/${album.slug}`} className="album-embed-masonry-grid">
        {ids.map((id, i) => {
          const isLast = i === ids.length - 1;
          return (
            <div key={id} className="album-embed-masonry-tile">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getThumbUrl(album.slug, id)}
                alt=""
                loading="lazy"
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
