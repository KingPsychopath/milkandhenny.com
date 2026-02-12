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

/**
 * Full album gallery with masonry/single toggle, multi-select, and batch download.
 */
export function AlbumGallery({ albumSlug, photos }: AlbumGalleryProps) {
  const [selectable, setSelectable] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
    if (selected.size === 0) return;

    if (selected.size === 1) {
      const id = Array.from(selected)[0];
      const url = getOriginalUrl(albumSlug, id);
      const a = document.createElement("a");
      a.href = `/api/download?url=${encodeURIComponent(url)}`;
      a.download = `${id}.jpg`;
      a.click();
      return;
    }

    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    const downloads = Array.from(selected).map(async (id) => {
      const url = getOriginalUrl(albumSlug, id);
      const res = await fetch(`/api/download?url=${encodeURIComponent(url)}`);
      const blob = await res.blob();
      zip.file(`${id}.jpg`, blob);
    });

    await Promise.all(downloads);
    const content = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(content);
    a.download = `${albumSlug}-photos.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [selected, albumSlug]);

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
              className="font-mono text-[11px] text-amber-600 hover:text-amber-500 transition-colors tracking-wide"
            >
              [ download {selected.size} ]
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
