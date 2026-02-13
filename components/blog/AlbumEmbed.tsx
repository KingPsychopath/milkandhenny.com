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

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Lazy-loaded thumbnail with warm placeholder */
const PreviewThumb = memo(function PreviewThumb({
  slug,
  photoId,
  overlay,
}: {
  slug: string;
  photoId: string;
  overlay?: string;
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

  return (
    <div className="album-embed-thumb">
      <div className="album-embed-thumb-placeholder" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {!errored && (
        <img
          ref={imgRef}
          alt=""
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
          className={`album-embed-thumb-img ${loaded ? "loaded" : ""}`}
        />
      )}
      {overlay && (
        <div className="album-embed-thumb-overlay">
          <span className="font-mono text-xs text-white/90 tracking-wide">
            +{overlay}
          </span>
        </div>
      )}
    </div>
  );
});

/**
 * Album preview card embedded in blog prose.
 * Shows a thumbnail strip (cover + up to 3 more) with title and metadata.
 * Entire card links to the album page.
 *
 * Returns null if data is missing or malformed — never crashes the page.
 */
function AlbumEmbed({ album }: { album: EmbeddedAlbum }) {
  // Defensive: bail to nothing if data is invalid
  if (!album?.slug || !album?.title || !album?.previewIds?.length) {
    return null;
  }

  const remaining = album.photoCount - album.previewIds.length;
  const showOverlay = remaining > 0;

  return (
    <Link href={`/pics/${album.slug}`} className="album-embed">
      {/* Thumbnail strip */}
      <div className="album-embed-strip">
        {album.previewIds.map((id, i) => (
          <PreviewThumb
            key={id}
            slug={album.slug}
            photoId={id}
            overlay={
              showOverlay && i === album.previewIds.length - 1
                ? String(remaining)
                : undefined
            }
          />
        ))}
      </div>

      {/* Metadata */}
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

export { AlbumEmbed };
export type { EmbeddedAlbum };
