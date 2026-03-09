"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { MasonryGrid } from "./MasonryGrid";
import { PhotoCard } from "./PhotoCard";
import type { Photo } from "@/features/media/albums";
import { getThumbUrl, getOriginalStorageKey, getOriginalUrl } from "@/features/media/storage";
import {
  BLOB_ZIP_DOWNLOAD_LIMIT_BYTES,
  LARGE_STREAMING_ZIP_NOTICE_BYTES,
  canUseSaveFilePicker,
  createZipFileWritable,
  fetchContentLength,
  downloadViaPresignedUrl,
  downloadBlob,
  getZipDownloadErrorMessage,
  isAbortError,
} from "@/lib/client/media-download";
import { buildZipArchive, type ZipSourceFile } from "@/lib/client/streaming-zip";
import {
  getMultipartArchiveName,
  planZipDownload,
  type ZipPlan,
  type ZipPlanTotalBytes,
} from "@/lib/client/zip-planner";
import { formatBytes } from "@/lib/shared/format";
import { mapWithConcurrency } from "@/lib/shared/map-with-concurrency";

type AlbumGalleryProps = {
  albumSlug: string;
  photos: Photo[];
};

const BATCH_DOWNLOAD_WARN = 20;
const SIZE_LOOKUP_CONCURRENCY = 5;

type DownloadProgress = {
  done: number;
  total: number;
  phase: "fetching" | "zipping";
  partIndex?: number;
  partCount?: number;
};

type PreparedZipDownload = {
  archiveName: string;
  files: ZipSourceFile[];
  plan: ZipPlan;
  sizeLookupIncomplete: boolean;
};

type PendingMultipartDownload = PreparedZipDownload & {
  plan: Extract<ZipPlan, { mode: "blob-multipart" }>;
};

function formatTotalBytes(total: ZipPlanTotalBytes): string | null {
  return total.known ? formatBytes(total.bytes) : null;
}

export function AlbumGallery({ albumSlug, photos }: AlbumGalleryProps) {
  const [selectable, setSelectable] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preparingDownload, setPreparingDownload] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const [supportsStreamingZip, setSupportsStreamingZip] = useState(false);
  const [pendingMultipartDownload, setPendingMultipartDownload] = useState<PendingMultipartDownload | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sizeCacheRef = useRef<Map<string, number>>(new Map());
  const photoById = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos]);
  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const selectedKey = useMemo(() => selectedIds.join("|"), [selectedIds]);
  const selectedTotalBytes = useMemo(() => {
    let total = 0;

    for (const id of selectedIds) {
      const size = photoById.get(id)?.size ?? sizeCacheRef.current.get(id);
      if (typeof size !== "number") return null;
      total += size;
    }

    return total;
  }, [photoById, selectedIds]);

  useEffect(() => {
    setSupportsStreamingZip(canUseSaveFilePicker());
  }, []);

  useEffect(() => {
    setPendingMultipartDownload(null);
  }, [photos, selectedKey]);

  useEffect(() => {
    if (!downloading) return;

    const handleBeforeUnload = () => {
      abortControllerRef.current?.abort(new DOMException("Page unloading", "AbortError"));
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [downloading]);

  const resolveAlbumZipFiles = useCallback(
    async (ids: string[]): Promise<{ files: ZipSourceFile[]; sizeLookupIncomplete: boolean }> => {
      const unresolvedIds = ids.filter((id) => {
        const size = photoById.get(id)?.size ?? sizeCacheRef.current.get(id);
        return typeof size !== "number";
      });

      let sizeLookupIncomplete = false;

      if (unresolvedIds.length > 0) {
        const resolvedSizes = await mapWithConcurrency(unresolvedIds, SIZE_LOOKUP_CONCURRENCY, async (id) => {
          try {
            const size = await fetchContentLength(getOriginalUrl(albumSlug, id));
            return { id, size };
          } catch {
            return { id, size: null };
          }
        });

        for (const resolved of resolvedSizes) {
          if (typeof resolved.size === "number") {
            sizeCacheRef.current.set(resolved.id, resolved.size);
          } else {
            sizeLookupIncomplete = true;
          }
        }
      }

      return {
        files: ids.map((id) => ({
          id,
          url: getOriginalUrl(albumSlug, id),
          filename: `${id}.jpg`,
          size: photoById.get(id)?.size ?? sizeCacheRef.current.get(id),
        })),
        sizeLookupIncomplete,
      };
    },
    [albumSlug, photoById]
  );

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
      if (prev) {
        setSelected(new Set());
        setPendingMultipartDownload(null);
      }
      return !prev;
    });
  }, []);

  const runArchiveBuild = useCallback(
    async (
      files: ZipSourceFile[],
      archiveName: string,
      controller: AbortController,
      options?: { streamToDisk?: boolean; partIndex?: number; partCount?: number }
    ) => {
      const writable = options?.streamToDisk ? await createZipFileWritable(archiveName) : null;

      const result = await buildZipArchive({
        files,
        signal: controller.signal,
        onProgress: (progress) => {
          setDownloadProgress({
            done: progress.done,
            total: progress.total,
            phase: progress.phase,
            partIndex: options?.partIndex,
            partCount: options?.partCount,
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
    },
    []
  );

  const executePreparedDownload = useCallback(
    async (prepared: PreparedZipDownload) => {
      setPendingMultipartDownload(null);
      setDownloading(true);
      setDownloadError("");

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        if (prepared.plan.mode === "blob-multipart") {
          for (let index = 0; index < prepared.plan.parts.length; index += 1) {
            if (controller.signal.aborted) break;
            const part = prepared.plan.parts[index];
            setDownloadProgress({
              done: 0,
              total: part.files.length,
              phase: "fetching",
              partIndex: index + 1,
              partCount: prepared.plan.partCount,
            });
            await runArchiveBuild(
              part.files,
              getMultipartArchiveName(prepared.archiveName, index + 1, prepared.plan.partCount),
              controller,
              {
                partIndex: index + 1,
                partCount: prepared.plan.partCount,
              }
            );
          }
          return;
        }

        await runArchiveBuild(prepared.files, prepared.archiveName, controller, {
          streamToDisk: prepared.plan.mode === "streaming-single",
        });
      } catch (err) {
        if (isAbortError(err)) return;
        console.error("Download failed:", err);
        setDownloadError(
          getZipDownloadErrorMessage(
            err,
            "ZIP download failed. Try a smaller selection or open this page in Chrome or Edge."
          )
        );
      } finally {
        abortControllerRef.current = null;
        setDownloading(false);
        setDownloadProgress(null);
      }
    },
    [runArchiveBuild]
  );

  const downloadSelected = useCallback(async () => {
    if (selected.size === 0 || downloading || preparingDownload) return;

    if (
      selected.size > BATCH_DOWNLOAD_WARN &&
      !window.confirm(
        `You're about to download ${selected.size} full-resolution photos. This may use a lot of memory on your device. Continue?`
      )
    ) {
      return;
    }

    setDownloadError("");
    setPendingMultipartDownload(null);
    setPreparingDownload(true);

    try {
      const ids = Array.from(selected);
      if (ids.length === 1) {
        const id = ids[0];
        await downloadViaPresignedUrl(getOriginalStorageKey(albumSlug, id), `${id}.jpg`);
        return;
      }

      const resolved = await resolveAlbumZipFiles(ids);
      const prepared: PreparedZipDownload = {
        archiveName: `${albumSlug}-photos.zip`,
        files: resolved.files,
        plan: planZipDownload(resolved.files, {
          pickerAvailable: supportsStreamingZip,
          maxPartBytes: BLOB_ZIP_DOWNLOAD_LIMIT_BYTES,
        }),
        sizeLookupIncomplete: resolved.sizeLookupIncomplete,
      };

      if (prepared.plan.mode === "oversize-file") {
        setDownloadError(
          `"${prepared.plan.filename}" is larger than ${formatBytes(BLOB_ZIP_DOWNLOAD_LIMIT_BYTES)} and cannot be included in a ZIP on this browser. For a single uninterrupted ZIP download, use Chrome or Edge, or download that file individually.`
        );
        return;
      }

      if (prepared.plan.mode === "blob-multipart") {
        setPendingMultipartDownload({
          ...prepared,
          plan: prepared.plan,
        });
        return;
      }

      await executePreparedDownload(prepared);
    } catch (err) {
      if (isAbortError(err)) return;
      console.error("Download failed:", err);
      setDownloadError(
        getZipDownloadErrorMessage(
          err,
          "ZIP download failed. Try a smaller selection or open this page in Chrome or Edge."
        )
      );
    } finally {
      setPreparingDownload(false);
    }
  }, [
    albumSlug,
    downloading,
    executePreparedDownload,
    preparingDownload,
    resolveAlbumZipFiles,
    selected,
    supportsStreamingZip,
  ]);

  const startMultipartDownload = useCallback(async () => {
    if (!pendingMultipartDownload || downloading || preparingDownload) return;
    await executePreparedDownload(pendingMultipartDownload);
  }, [downloading, executePreparedDownload, pendingMultipartDownload, preparingDownload]);

  const cancelDownload = useCallback(() => {
    setDownloadError("Download cancelled.");
    setPendingMultipartDownload(null);
    abortControllerRef.current?.abort(new DOMException("Download cancelled", "AbortError"));
  }, []);

  const busy = preparingDownload || downloading;
  const progressLabel =
    preparingDownload
      ? "[ preparing download... ]"
      : downloadProgress?.phase === "fetching"
        ? downloadProgress.partCount
          ? `[ part ${downloadProgress.partIndex}/${downloadProgress.partCount} · ${downloadProgress.done}/${downloadProgress.total} fetched... ]`
          : `[ ${downloadProgress.done}/${downloadProgress.total} fetched... ]`
        : downloadProgress?.phase === "zipping"
          ? downloadProgress.partCount
            ? `[ part ${downloadProgress.partIndex}/${downloadProgress.partCount} · finalizing archive... ]`
            : "[ finalizing archive... ]"
          : "[ zipping... ]";

  return (
    <div>
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
                disabled={busy}
                className="font-mono text-micro text-amber-600 hover:text-amber-500 transition-colors tracking-wide disabled:opacity-50"
              >
                {busy ? progressLabel : `[ download ${selected.size} ]`}
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
      {pendingMultipartDownload ? (
        <div className="mb-4 rounded-sm border theme-border px-3 py-3">
          <p className="font-mono text-micro tracking-wide">
            This download will be split into {pendingMultipartDownload.plan.partCount} parts (up to {formatBytes(BLOB_ZIP_DOWNLOAD_LIMIT_BYTES)} each).
          </p>
          <p className="mt-2 font-mono text-nano theme-muted tracking-wide">
            For a single uninterrupted ZIP download, use Chrome or Edge.
          </p>
          {pendingMultipartDownload.sizeLookupIncomplete || !pendingMultipartDownload.plan.total.known ? (
            <p className="mt-2 font-mono text-nano theme-muted tracking-wide">
              Some file sizes could not be confirmed. Parts were planned conservatively.
            </p>
          ) : formatTotalBytes(pendingMultipartDownload.plan.total) ? (
            <p className="mt-2 font-mono text-nano theme-muted tracking-wide">
              Total selected: {formatTotalBytes(pendingMultipartDownload.plan.total)}
            </p>
          ) : null}
          <div className="mt-3 flex items-center gap-3 font-mono text-micro tracking-wide">
            <button
              onClick={startMultipartDownload}
              disabled={busy}
              className="text-amber-600 hover:text-amber-500 transition-colors disabled:opacity-50"
            >
              [ download in {pendingMultipartDownload.plan.partCount} parts ]
            </button>
            <button
              onClick={() => setPendingMultipartDownload(null)}
              disabled={busy}
              className="theme-muted hover:text-foreground transition-colors disabled:opacity-50"
            >
              [ dismiss ]
            </button>
          </div>
        </div>
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
