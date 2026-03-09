"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { MasonryGrid } from "./MasonryGrid";
import { PhotoCard } from "./PhotoCard";
import type { Photo } from "@/features/media/albums";
import { getThumbUrl, getOriginalUrl } from "@/features/media/storage";
import {
  BLOB_ZIP_DOWNLOAD_LIMIT_BYTES,
  LARGE_STREAMING_ZIP_NOTICE_BYTES,
  canUseSaveFilePicker,
  createZipFileWritable,
  fetchBlob,
  fetchContentLength,
  downloadBlob,
  getZipDownloadErrorMessage,
  isAbortError,
} from "@/lib/client/media-download";
import { buildZipArchive } from "@/lib/client/streaming-zip";
import { formatBytes } from "@/lib/shared/format";
import { mapWithConcurrency } from "@/lib/shared/map-with-concurrency";

type AlbumGalleryProps = {
  albumSlug: string;
  photos: Photo[];
};

/** Max photos in a single batch download before showing a warning */
const BATCH_DOWNLOAD_WARN = 20;

const SIZE_LOOKUP_CONCURRENCY = 5;

type DownloadProgress = {
  done: number;
  total: number;
  phase: "fetching" | "zipping";
};

/**
 * Full album gallery with masonry/single toggle, multi-select, and batch download.
 * Uses shared download utilities with retry support and progress feedback.
 * Batch downloads are chunked to avoid memory pressure on large selections.
 */
export function AlbumGallery({ albumSlug, photos }: AlbumGalleryProps) {
  const [selectable, setSelectable] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const [supportsStreamingZip, setSupportsStreamingZip] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sizeCacheRef = useRef<Map<string, number>>(new Map());
  const photoById = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos]);
  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const selectedTotalBytes = useMemo(() => {
    let total = 0;

    for (const id of selectedIds) {
      const size = photoById.get(id)?.size ?? sizeCacheRef.current.get(id);
      if (typeof size !== "number") return null;
      total += size;
    }

    return total;
  }, [photoById, selectedIds]);

  const resolveSelectedTotalBytes = useCallback(
    async (ids: string[]): Promise<number | null> => {
      let total = 0;
      const unresolvedIds: string[] = [];

      for (const id of ids) {
        const size = photoById.get(id)?.size ?? sizeCacheRef.current.get(id);
        if (typeof size === "number") {
          total += size;
          if (!sizeCacheRef.current.has(id)) sizeCacheRef.current.set(id, size);
          continue;
        }
        unresolvedIds.push(id);
      }

      if (unresolvedIds.length === 0) return total;

      const resolvedSizes = await mapWithConcurrency(unresolvedIds, SIZE_LOOKUP_CONCURRENCY, async (id) => {
        const size = await fetchContentLength(getOriginalUrl(albumSlug, id));
        return { id, size };
      });

      for (const resolved of resolvedSizes) {
        if (typeof resolved.size !== "number") return null;
        sizeCacheRef.current.set(resolved.id, resolved.size);
        total += resolved.size;
      }

      return total;
    },
    [albumSlug, photoById]
  );

  useEffect(() => {
    setSupportsStreamingZip(canUseSaveFilePicker());
  }, []);

  useEffect(() => {
    if (!downloading) return;

    const handleBeforeUnload = () => {
      abortControllerRef.current?.abort(new DOMException("Page unloading", "AbortError"));
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [downloading]);

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

    setDownloadError("");
    const ids = Array.from(selected);
    const canStreamToDisk = supportsStreamingZip;

    if (ids.length > 1 && !canStreamToDisk) {
      const totalBytes = await resolveSelectedTotalBytes(ids);
      if (totalBytes === null) {
        setDownloadError("Could not determine ZIP size in this browser. Open this page in Chrome or Edge, or download files individually.");
        return;
      }
      if (totalBytes > BLOB_ZIP_DOWNLOAD_LIMIT_BYTES) {
        setDownloadError(
          `ZIP downloads over ${formatBytes(BLOB_ZIP_DOWNLOAD_LIMIT_BYTES)} require Chrome or Edge. Download files individually, or open this page in Chrome.`
        );
        return;
      }
    }

    setDownloading(true);

    try {
      if (ids.length === 1) {
        const id = ids[0];
        const blob = await fetchBlob(getOriginalUrl(albumSlug, id));
        downloadBlob(blob, `${id}.jpg`);
        return;
      }

      setDownloadProgress({ done: 0, total: ids.length, phase: "fetching" });

      const archiveName = `${albumSlug}-photos.zip`;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const writable = canStreamToDisk ? await createZipFileWritable(archiveName) : null;
      const result = await buildZipArchive({
        files: ids.map((id) => ({
          id,
          url: getOriginalUrl(albumSlug, id),
          filename: `${id}.jpg`,
          size: photoById.get(id)?.size ?? sizeCacheRef.current.get(id),
        })),
        signal: controller.signal,
        onProgress: (progress) => {
          setDownloadProgress({
            done: progress.done,
            total: progress.total,
            phase: progress.phase,
          });
        },
        saveTarget: writable
          ? {
              write: async (chunk) => {
                await writable.write(new Uint8Array(chunk));
              },
              close: async () => {
                await writable.close();
              },
              abort: async (reason) => {
                await writable.abort(reason);
              },
            }
          : undefined,
      });

      if (result.type === "blob") {
        downloadBlob(result.blob, archiveName);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      console.error("Download failed:", err);
      setDownloadError(getZipDownloadErrorMessage(err, "ZIP download failed. Try a smaller selection or open this page in Chrome or Edge."));
    } finally {
      abortControllerRef.current = null;
      setDownloading(false);
      setDownloadProgress(null);
    }
  }, [albumSlug, downloading, photoById, resolveSelectedTotalBytes, selected, supportsStreamingZip]);

  const cancelDownload = useCallback(() => {
    setDownloadError("Download cancelled.");
    abortControllerRef.current?.abort(new DOMException("Download cancelled", "AbortError"));
  }, []);

  const progressLabel =
    downloadProgress?.phase === "fetching"
      ? `[ ${downloadProgress.done}/${downloadProgress.total} fetched... ]`
      : downloadProgress?.phase === "zipping"
        ? "[ finalizing archive... ]"
        : "[ zipping... ]";

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={toggleSelectMode}
            className="font-mono text-micro theme-muted hover:text-foreground transition-colors tracking-wide"
          >
            {selectable ? "[ cancel ]" : "[ select ]"}
          </button>
          {selectable && selected.size > 0 && (
            <>
              <button
                onClick={downloadSelected}
                disabled={downloading}
                className="font-mono text-micro text-amber-600 hover:text-amber-500 transition-colors tracking-wide disabled:opacity-50"
              >
                {downloading ? progressLabel : `[ download ${selected.size} ]`}
              </button>
              {downloading && downloadProgress ? (
                <button
                  onClick={cancelDownload}
                  className="font-mono text-micro theme-muted hover:text-foreground transition-colors tracking-wide"
                >
                  [ cancel download ]
                </button>
              ) : null}
            </>
          )}
        </div>
        <span className="font-mono text-micro theme-muted tracking-wide">
          {selected.size > 0 && selectedTotalBytes !== null
            ? `${selected.size} selected • ${formatBytes(selectedTotalBytes)}`
            : `${photos.length} photos`}
        </span>
      </div>
      {downloadError ? (
        <p className="mb-4 font-mono text-micro tracking-wide text-red-600">
          {downloadError}
        </p>
      ) : null}
      {supportsStreamingZip && selected.size > 1 && selectedTotalBytes !== null && selectedTotalBytes >= LARGE_STREAMING_ZIP_NOTICE_BYTES ? (
        <p className="mb-4 font-mono text-nano theme-muted tracking-wide">
          Large ZIPs in Chrome or Edge may temporarily require about 2x the archive size free on disk before the file is committed.
        </p>
      ) : null}

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
