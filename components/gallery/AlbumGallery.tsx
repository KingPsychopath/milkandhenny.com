"use client";

import { useState, useCallback, useRef } from "react";
import { MasonryGrid } from "./MasonryGrid";
import { PhotoCard } from "./PhotoCard";
import type { Photo } from "@/lib/albums";
import { getThumbUrl, getOriginalUrl } from "@/lib/storage";
import { fetchBlob, downloadBlob } from "@/lib/download";

type AlbumGalleryProps = {
  albumSlug: string;
  photos: Photo[];
};

/** Max photos in a single batch download before showing a warning */
const BATCH_DOWNLOAD_WARN = 20;

/**
 * Full album gallery with masonry/single toggle, multi-select, and batch download.
 * Uses shared download utilities with retry support and progress feedback.
 */
export function AlbumGallery({ albumSlug, photos }: AlbumGalleryProps) {
  const [selectable, setSelectable] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ done: number; total: number } | null>(null);
  const abortRef = useRef(false);

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

    if (
      selected.size > BATCH_DOWNLOAD_WARN &&
      !window.confirm(
        `You're about to download ${selected.size} full-resolution photos. This may use a lot of memory on your device. Continue?`
      )
    ) {
      return;
    }

    setDownloading(true);
    abortRef.current = false;

    try {
      if (selected.size === 1) {
        const id = Array.from(selected)[0];
        const blob = await fetchBlob(getOriginalUrl(albumSlug, id));
        downloadBlob(blob, `${id}.jpg`);
        return;
      }

      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const ids = Array.from(selected);

      setDownloadProgress({ done: 0, total: ids.length });

      /* Fetch all images in parallel — direct from R2, no proxy */
      await Promise.all(
        ids.map(async (id) => {
          if (abortRef.current) return;
          const blob = await fetchBlob(getOriginalUrl(albumSlug, id));
          zip.file(`${id}.jpg`, blob);
          setDownloadProgress((prev) =>
            prev ? { ...prev, done: prev.done + 1 } : null
          );
        })
      );

      if (!abortRef.current) {
        const content = await zip.generateAsync({ type: "blob" });
        downloadBlob(content, `${albumSlug}-photos.zip`);
      }
    } catch (err) {
      console.error("Download failed:", err);
    } finally {
      setDownloading(false);
      setDownloadProgress(null);
    }
  }, [selected, albumSlug, downloading]);

  const progressLabel = downloadProgress
    ? `[ ${downloadProgress.done}/${downloadProgress.total} fetched... ]`
    : "[ zipping... ]";

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
              {downloading ? progressLabel : `[ download ${selected.size} ]`}
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
