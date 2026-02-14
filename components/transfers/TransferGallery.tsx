"use client";

import { useState, useCallback, useEffect, useRef, memo } from "react";
import {
  getTransferThumbUrl,
  getTransferFullUrl,
  getTransferFileUrl,
} from "@/lib/media/storage";
import { fetchBlob, downloadBlob } from "@/lib/media/download";
import { formatBytes } from "@/lib/format";
import { useLazyImage } from "@/hooks/useLazyImage";
import { useSwipe } from "@/hooks/useSwipe";
import { SelectionToggle } from "@/components/SelectionToggle";
import type { FileKind } from "@/lib/transfers";

/* ─── Types ─── */

type TransferFileData = {
  id: string;
  filename: string;
  kind: FileKind;
  size: number;
  mimeType: string;
  width?: number;
  height?: number;
};

type TransferGalleryProps = {
  transferId: string;
  files: TransferFileData[];
};

/* ─── Icon SVGs for non-visual file types ─── */

function FileIcon({ kind, mimeType }: { kind: FileKind; mimeType: string }) {
  if (kind === "video") {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    );
  }
  if (kind === "audio") {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
      </svg>
    );
  }
  if (mimeType === "application/pdf") {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    );
  }
  if (mimeType.includes("zip") || mimeType.includes("rar") || mimeType.includes("7z") || mimeType.includes("tar") || mimeType.includes("gzip")) {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" />
        <path d="M10 12h4" />
      </svg>
    );
  }
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

/* ─── Lightbox Content ─── */

function LightboxContent({
  file,
  transferId,
  onError,
}: {
  file: TransferFileData;
  transferId: string;
  onError: () => void;
}) {
  const [loading, setLoading] = useState(true);

  if (file.kind === "video") {
    return (
      <video
        src={getTransferFileUrl(transferId, file.filename)}
        controls
        autoPlay
        className="max-w-full max-h-[80vh] photo-page-fade-in"
        style={{ objectFit: "contain" }}
        onClick={(e) => e.stopPropagation()}
        onLoadedData={() => setLoading(false)}
        onError={onError}
      />
    );
  }

  const imgSrc =
    file.kind === "gif"
      ? getTransferFileUrl(transferId, file.filename)
      : getTransferFullUrl(transferId, file.id);

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-[11px] text-white/50 tracking-wide animate-pulse">
            loading...
          </span>
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imgSrc}
        alt={file.filename}
        className={`max-w-full max-h-[80vh] object-contain transition-opacity duration-300 ${
          loading ? "opacity-0" : "opacity-100"
        }`}
        onLoad={() => setLoading(false)}
        onError={onError}
      />
    </div>
  );
}

/* ─── Main Gallery ─── */

/**
 * Multi-type transfer gallery.
 * - Images + GIFs: masonry grid with lightbox
 * - Videos: masonry grid cards with play overlay, lightbox with <video>
 * - Files/Audio: list section below the gallery with download buttons
 */
export function TransferGallery({ transferId, files }: TransferGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ done: number; total: number } | null>(null);
  const [savingSingle, setSavingSingle] = useState(false);
  const [lightboxError, setLightboxError] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  // Split files into visual (gallery) and non-visual (list)
  const visualFiles = files.filter((f) => f.kind === "image" || f.kind === "gif" || f.kind === "video");
  const nonVisualFiles = files.filter((f) => f.kind === "audio" || f.kind === "file");

  const openLightbox = useCallback((index: number) => {
    setLightboxError(false);
    setLightboxIndex(index);
  }, []);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);

  const goNext = useCallback(() => {
    setLightboxError(false);
    setLightboxIndex((prev) =>
      prev !== null && prev < visualFiles.length - 1 ? prev + 1 : prev
    );
  }, [visualFiles.length]);

  const goPrev = useCallback(() => {
    setLightboxError(false);
    setLightboxIndex((prev) =>
      prev !== null && prev > 0 ? prev - 1 : prev
    );
  }, []);

  /* Keyboard navigation */
  useEffect(() => {
    if (lightboxIndex === null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxIndex, closeLightbox, goNext, goPrev]);

  /* Swipe detection via shared hook */
  const swipeRef = useSwipe<HTMLDivElement>({
    onSwipeLeft: goNext,
    onSwipeRight: goPrev,
    enabled: lightboxIndex !== null,
  });

  /* Lock body scroll when lightbox open */
  useEffect(() => {
    document.body.style.overflow = lightboxIndex !== null ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [lightboxIndex]);

  /** Download a single file */
  const downloadSingle = useCallback(
    async (file: TransferFileData) => {
      if (savingSingle) return;
      setSavingSingle(true);
      try {
        const blob = await fetchBlob(getTransferFileUrl(transferId, file.filename));
        downloadBlob(blob, file.filename);
      } catch (err) {
        console.error("Download failed:", err);
      } finally {
        setSavingSingle(false);
      }
    },
    [transferId, savingSingle]
  );

  /** Download a subset of files (zip or single) */
  const downloadFiles = useCallback(
    async (filesToDownload: TransferFileData[]) => {
      if (downloading || filesToDownload.length === 0) return;
      setDownloading(true);
      try {
        if (filesToDownload.length === 1) {
          const blob = await fetchBlob(getTransferFileUrl(transferId, filesToDownload[0].filename));
          downloadBlob(blob, filesToDownload[0].filename);
          return;
        }

        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        setDownloadProgress({ done: 0, total: filesToDownload.length });

        await Promise.all(
          filesToDownload.map(async (f) => {
            const blob = await fetchBlob(getTransferFileUrl(transferId, f.filename));
            zip.file(f.filename, blob);
            setDownloadProgress((prev) =>
              prev ? { ...prev, done: prev.done + 1 } : null
            );
          })
        );

        const content = await zip.generateAsync({ type: "blob" });
        downloadBlob(content, `transfer-${transferId}-selected.zip`);
      } catch (err) {
        console.error("Download failed:", err);
      } finally {
        setDownloading(false);
        setDownloadProgress(null);
      }
    },
    [transferId, downloading]
  );

  /** Download all files as a zip with progress */
  const downloadAll = useCallback(() => {
    if (files.length === 0) return;
    downloadFiles(files);
  }, [files, downloadFiles]);

  /** Download only selected files */
  const downloadSelected = useCallback(() => {
    const selected = files.filter((f) => selectedIds.has(f.id));
    if (selected.length === 0) return;
    downloadFiles(selected);
  }, [files, selectedIds, downloadFiles]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(files.map((f) => f.id)));
  }, [files]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectedCount = selectedIds.size;
  const allSelected = files.length > 0 && selectedCount === files.length;

  const currentVisual = lightboxIndex !== null ? visualFiles[lightboxIndex] : null;

  const downloadLabel = downloadProgress
    ? `[ ${downloadProgress.done}/${downloadProgress.total} fetched... ]`
    : "[ zipping... ]";

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <span className="font-mono text-[11px] theme-muted tracking-wide">
          {selectedCount > 0
            ? `${selectedCount} of ${files.length} selected`
            : `${files.length} ${files.length === 1 ? "file" : "files"}`}
        </span>
        <div className="flex items-center gap-3 font-mono text-[11px] tracking-wide">
          {selectedCount > 0 && (
            <>
              <button
                onClick={clearSelection}
                className="theme-muted hover:text-foreground transition-colors"
              >
                [ clear ]
              </button>
              <button
                onClick={downloadSelected}
                disabled={downloading}
                className="text-amber-600 hover:text-amber-500 transition-colors disabled:opacity-50"
              >
                {downloading && downloadProgress && downloadProgress.total === selectedCount
                  ? downloadLabel
                  : "[ download selected ]"}
              </button>
            </>
          )}
          {!allSelected && files.length > 1 && (
            <button
              onClick={selectAll}
              className="theme-muted hover:text-foreground transition-colors"
            >
              [ select all ]
            </button>
          )}
          <button
            onClick={downloadAll}
            disabled={downloading}
            className="text-amber-600 hover:text-amber-500 transition-colors disabled:opacity-50"
          >
            {downloading && (!downloadProgress || downloadProgress.total === files.length)
              ? downloadLabel
              : "[ download all ]"}
          </button>
        </div>
      </div>

      {/* Visual media grid (images, GIFs, videos) */}
      {visualFiles.length > 0 && (
        <div className="gallery-masonry">
          {visualFiles.map((file, index) => (
            <VisualCard
              key={file.id}
              transferId={transferId}
              file={file}
              isSelected={selectedIds.has(file.id)}
              onToggleSelect={() => toggleSelection(file.id)}
              onClick={() => openLightbox(index)}
            />
          ))}
        </div>
      )}

      {/* Non-visual files list (audio, documents, archives) */}
      {nonVisualFiles.length > 0 && (
        <div className={visualFiles.length > 0 ? "mt-8" : ""}>
          {visualFiles.length > 0 && (
            <p className="font-mono text-[11px] theme-muted tracking-wide mb-3">
              files
            </p>
          )}
          <div className="space-y-2">
            {nonVisualFiles.map((file) => (
              <FileCard
                key={file.id}
                transferId={transferId}
                file={file}
                isSelected={selectedIds.has(file.id)}
                onToggleSelect={() => toggleSelection(file.id)}
                onDownload={() => downloadSingle(file)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Lightbox (images, GIFs, videos) */}
      {currentVisual && lightboxIndex !== null && (
        <div
          ref={swipeRef}
          className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center touch-pan-y"
          onClick={closeLightbox}
        >
          <button
            onClick={closeLightbox}
            className="absolute top-4 right-4 z-10 font-mono text-sm text-white/60 hover:text-white transition-colors"
            aria-label="Close"
          >
            ✕
          </button>

          {/* Media content with loading state */}
          <div className="flex items-center justify-center px-4" style={{ maxWidth: "80vw", maxHeight: "80vh" }}>
            {lightboxError ? (
              <div className="flex flex-col items-center justify-center gap-4 py-20" onClick={(e) => e.stopPropagation()}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="text-white/20" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <p className="font-mono text-sm text-white/40 tracking-wide">
                  failed to load {currentVisual.filename}
                </p>
                <button
                  onClick={() => downloadSingle(currentVisual)}
                  disabled={savingSingle}
                  className="font-mono text-xs text-amber-500 hover:text-amber-400 transition-colors"
                >
                  [ try downloading instead ]
                </button>
              </div>
            ) : (
              <LightboxContent
                file={currentVisual}
                transferId={transferId}
                onError={() => setLightboxError(true)}
              />
            )}
          </div>

          {/* Controls — stop propagation so clicking nav/download doesn't close */}
          <div
            className="flex items-center justify-between mt-4 max-w-md w-full px-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-4 font-mono text-xs text-white/50">
              {lightboxIndex > 0 ? (
                <button onClick={goPrev} className="hover:text-white transition-colors">
                  ← prev
                </button>
              ) : (
                <span className="text-white/20">← prev</span>
              )}
              {lightboxIndex < visualFiles.length - 1 ? (
                <button onClick={goNext} className="hover:text-white transition-colors">
                  next →
                </button>
              ) : (
                <span className="text-white/20">next →</span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <span className="font-mono text-[11px] text-white/30">
                {lightboxIndex + 1} / {visualFiles.length}
              </span>
              <button
                onClick={() => downloadSingle(currentVisual)}
                disabled={savingSingle}
                className="font-mono text-xs text-white/50 hover:text-white transition-colors disabled:opacity-50"
              >
                {savingSingle ? "saving..." : "download ↓"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Visual Card (images, GIFs, videos in masonry grid) ─── */

/** Warm broken-image placeholder that matches the design system */
function BrokenImageFallback({ filename }: { filename: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-stone-100 dark:bg-stone-800">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="theme-muted opacity-40" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
      <span className="font-mono text-[10px] theme-muted opacity-60 tracking-wide truncate max-w-[80%] px-2 text-center">
        {filename}
      </span>
    </div>
  );
}

const VisualCard = memo(function VisualCard({
  transferId,
  file,
  isSelected,
  onToggleSelect,
  onClick,
}: {
  transferId: string;
  file: TransferFileData;
  isSelected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
}) {
  // Images and GIFs have thumbnails; videos get a placeholder
  const hasThumbnail = file.kind === "image" || file.kind === "gif";
  const thumbUrl = hasThumbnail ? getTransferThumbUrl(transferId, file.id) : "";
  const aspectRatio = (file.width && file.height) ? file.height / file.width : 9 / 16;

  const { loaded, errored, handleLoad, handleError } = useLazyImage();

  return (
    <div className="gallery-card group">
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className="block relative overflow-hidden rounded-sm w-full text-left cursor-pointer"
        style={{ paddingBottom: `${aspectRatio * 100}%` }}
      >
        {/* Selection toggle — stop propagation so card click opens lightbox */}
        <div
          className="absolute top-2 left-2 z-10"
          onClick={(e) => e.stopPropagation()}
          role="none"
        >
          <SelectionToggle
            selected={isSelected}
            onToggle={onToggleSelect}
            variant="overlay"
          />
        </div>

        <div className="absolute inset-0 gallery-placeholder" />

        {hasThumbnail && !errored ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbUrl}
            alt={file.filename}
            width={file.width}
            height={file.height}
            loading="lazy"
            decoding="async"
            onLoad={handleLoad}
            onError={handleError}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
              loaded ? "opacity-100" : "opacity-0"
            }`}
          />
        ) : errored ? (
          <BrokenImageFallback filename={file.filename} />
        ) : (
          /* Video placeholder */
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="theme-muted" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span className="font-mono text-[10px] theme-muted tracking-wide truncate max-w-[90%] px-2">
              {file.filename}
            </span>
          </div>
        )}

        {/* Video play overlay */}
        {file.kind === "video" && hasThumbnail && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white" stroke="none">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
          </div>
        )}

        {/* GIF badge */}
        {file.kind === "gif" && (
          <div className="absolute bottom-2 left-2">
            <span className="font-mono text-[9px] bg-black/50 text-white/80 px-1.5 py-0.5 rounded tracking-wider uppercase">
              gif
            </span>
          </div>
        )}

        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-200" />
      </div>
    </div>
  );
});

/* ─── File Card (audio, documents, archives) ─── */

function FileCard({
  transferId,
  file,
  isSelected,
  onToggleSelect,
  onDownload,
}: {
  transferId: string;
  file: TransferFileData;
  isSelected: boolean;
  onToggleSelect: () => void;
  onDownload: () => void;
}) {
  const checkbox = (
    <SelectionToggle
      selected={isSelected}
      onToggle={onToggleSelect}
      variant="surface"
    />
  );

  // Inline audio player
  if (file.kind === "audio") {
    return (
      <div className="flex items-center gap-4 p-3 rounded-sm border theme-border group">
        {checkbox}
        <div className="theme-muted">
          <FileIcon kind={file.kind} mimeType={file.mimeType} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-sm text-foreground truncate">{file.filename}</p>
          <audio
            src={getTransferFileUrl(transferId, file.filename)}
            controls
            preload="none"
            className="w-full mt-2 h-8"
          />
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="font-mono text-[10px] theme-muted">{formatBytes(file.size)}</span>
          <button
            onClick={onDownload}
            className="font-mono text-[11px] text-amber-600 hover:text-amber-500 transition-colors"
          >
            ↓
          </button>
        </div>
      </div>
    );
  }

  // Generic file card
  return (
    <div className="flex items-center gap-4 p-3 rounded-sm border theme-border group">
      {checkbox}
      <div className="theme-muted">
        <FileIcon kind={file.kind} mimeType={file.mimeType} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-mono text-sm text-foreground truncate">{file.filename}</p>
        <p className="font-mono text-[10px] theme-muted mt-0.5">
          {file.mimeType.split("/").pop()} · {formatBytes(file.size)}
        </p>
      </div>
      <button
        onClick={onDownload}
        className="font-mono text-[11px] text-amber-600 hover:text-amber-500 transition-colors shrink-0"
      >
        [ download ]
      </button>
    </div>
  );
}
