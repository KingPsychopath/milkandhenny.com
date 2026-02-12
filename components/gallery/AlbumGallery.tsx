"use client";

import { useState, useCallback } from "react";
import { MasonryGrid } from "./MasonryGrid";
import { PhotoCard } from "./PhotoCard";
import type { Photo } from "@/lib/albums";
import { getThumbUrl, getOriginalUrl } from "@/lib/storage";

type AlbumGalleryProps = {
  albumSlug: string;
  photos: Photo[];
};

/** Fetch a blob directly from R2 (requires CORS configured on bucket) */
async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return res.blob();
}

/** Trigger a browser download from a blob */
function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}

/**
 * Full album gallery with masonry/single toggle, multi-select, and batch download.
 */
export function AlbumGallery({ albumSlug, photos }: AlbumGalleryProps) {
  const [selectable, setSelectable] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);

  const toggleSelect = useCallback((photoId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }, []);

  const toggleSelectMode = useCallback(() => {
    setSelectable((prev) => {
      if (prev) setSelected(new Set());
      return !prev;
    });
  }, []);

  const downloadSelected = useCallback(async () => {
    if (selected.size === 0 || downloading) return;
    setDownloading(true);

    try {
      if (selected.size === 1) {
        const id = Array.from(selected)[0];
        const blob = await fetchBlob(getOriginalUrl(albumSlug, id));
        downloadBlob(blob, `${id}.jpg`);
        return;
      }

      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      /* Fetch all images in parallel — direct from R2, no proxy */
      await Promise.all(
        Array.from(selected).map(async (id) => {
          const blob = await fetchBlob(getOriginalUrl(albumSlug, id));
          zip.file(`${id}.jpg`, blob);
        })
      );

      const content = await zip.generateAsync({ type: "blob" });
      downloadBlob(content, `${albumSlug}-photos.zip`);
    } catch (err) {
      console.error("Download failed:", err);
    } finally {
      setDownloading(false);
    }
  }, [selected, albumSlug, downloading]);

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={toggleSelectMode}
            className="font-mono text-[11px] theme-muted hover:text-foreground transition-colors tracking-wide"
          >
            {selectable ? "[ cancel ]" : "[ select ]"}
          </button>
          {selectable && selected.size > 0 && (
            <button
              onClick={downloadSelected}
              disabled={downloading}
              className="font-mono text-[11px] text-amber-600 hover:text-amber-500 transition-colors tracking-wide disabled:opacity-50"
            >
              {downloading ? "[ zipping... ]" : `[ download ${selected.size} ]`}
            </button>
          )}
        </div>
        <span className="font-mono text-[11px] theme-muted tracking-wide">
          {photos.length} photos
        </span>
      </div>

      <MasonryGrid>
        {photos.map((photo) => (
          <PhotoCard
            key={photo.id}
            albumSlug={albumSlug}
            photoId={photo.id}
            thumbUrl={getThumbUrl(albumSlug, photo.id)}
            width={photo.width}
            height={photo.height}
            blur={photo.blur}
            selectable={selectable}
            selected={selected.has(photo.id)}
            onSelect={toggleSelect}
          />
        ))}
      </MasonryGrid>
    </div>
  );
}
