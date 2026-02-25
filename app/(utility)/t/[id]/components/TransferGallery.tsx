"use client";

import { useState, useCallback, useEffect, memo } from "react";
import { getTransferThumbUrl, getTransferFullUrl, getTransferFileUrl } from "@/features/media/storage";
import { fetchBlob, downloadBlob } from "@/lib/client/media-download";
import { formatBytes } from "@/lib/shared/format";
import { useLazyImage } from "@/hooks/useLazyImage";
import { useSwipe } from "@/hooks/useSwipe";
import { SelectionToggle } from "@/components/SelectionToggle";
import type { FileKind } from "@/features/transfers/store";

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

type GalleryFilter = "all" | "photos" | "videos" | "files";
type BrowseMode = "scroll" | "pages";

const INITIAL_VISUAL_RENDER_COUNT = 120;
const VISUAL_RENDER_INCREMENT = 120;
const INITIAL_FILE_LIST_RENDER_COUNT = 80;
const FILE_LIST_RENDER_INCREMENT = 120;
const PAGE_SIZE = 120;

function matchesFilter(file: TransferFileData, filter: GalleryFilter): boolean {
  if (filter === "all") return true;
  if (filter === "photos") return file.kind === "image" || file.kind === "gif";
  if (filter === "videos") return file.kind === "video";
  return file.kind === "audio" || file.kind === "file";
}

function PageControls({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border theme-border px-3 py-2">
      <p className="font-mono text-nano theme-muted tracking-wide">
        page {page} of {totalPages}
      </p>
      <div className="flex items-center gap-3 font-mono text-micro tracking-wide">
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={page <= 1}
          className="theme-muted hover:text-foreground transition-colors disabled:opacity-40"
        >
          [ first ]
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="theme-muted hover:text-foreground transition-colors disabled:opacity-40"
        >
          [ prev ]
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="theme-muted hover:text-foreground transition-colors disabled:opacity-40"
        >
          [ next ]
        </button>
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={page >= totalPages}
          className="theme-muted hover:text-foreground transition-colors disabled:opacity-40"
        >
          [ last ]
        </button>
      </div>
    </div>
  );
}

/* ─── Icon SVGs for non-visual file types ─── */

function FileIcon({ kind, mimeType }: { kind: FileKind; mimeType: string }) {
  if (kind === "video") {
    return (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    );
  }
  if (kind === "audio") {
    return (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    );
  }
  if (mimeType === "application/pdf") {
    return (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    );
  }
  if (
    mimeType.includes("zip") ||
    mimeType.includes("rar") ||
    mimeType.includes("7z") ||
    mimeType.includes("tar") ||
    mimeType.includes("gzip")
  ) {
    return (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 8v13H3V8" />
        <path d="M1 3h22v5H1z" />
        <path d="M10 12h4" />
      </svg>
    );
  }
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
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
  const { loaded, handleLoad, imgRef } = useLazyImage();

  if (file.kind === "video") {
    return (
      <video
        src={getTransferFileUrl(transferId, file.filename)}
        controls
        autoPlay
        className="max-w-full max-h-media photo-page-fade-in"
        style={{ objectFit: "contain" }}
        onClick={(e) => e.stopPropagation()}
        onError={onError}
      />
    );
  }

  const imgSrc =
    file.kind === "gif" ? getTransferFileUrl(transferId, file.filename) : getTransferFullUrl(transferId, file.id);

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-micro text-white/50 tracking-wide animate-pulse">loading...</span>
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={imgSrc}
        alt={file.filename}
        className={`max-w-full max-h-media object-contain transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        onLoad={handleLoad}
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
  const [activeFilter, setActiveFilter] = useState<GalleryFilter>("all");
  const [browseMode, setBrowseMode] = useState<BrowseMode>("scroll");
  const [page, setPage] = useState(1);

  const filterCounts = {
    all: files.length,
    photos: files.filter((f) => matchesFilter(f, "photos")).length,
    videos: files.filter((f) => matchesFilter(f, "videos")).length,
    files: files.filter((f) => matchesFilter(f, "files")).length,
  };

  const filteredFiles = files.filter((f) => matchesFilter(f, activeFilter));
  const totalPages = Math.max(1, Math.ceil(filteredFiles.length / PAGE_SIZE));
  const canPaginate = filteredFiles.length > PAGE_SIZE;

  useEffect(() => {
    setPage(1);
  }, [activeFilter, browseMode]);

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  const pageStartIndex = browseMode === "pages" ? (page - 1) * PAGE_SIZE : 0;
  const pageFiles =
    browseMode === "pages"
      ? filteredFiles.slice(pageStartIndex, pageStartIndex + PAGE_SIZE)
      : filteredFiles;

  // Split files into visual (gallery) and non-visual (list)
  const visualFiles = pageFiles.filter((f) => f.kind === "image" || f.kind === "gif" || f.kind === "video");
  const nonVisualFiles = pageFiles.filter((f) => f.kind === "audio" || f.kind === "file");
  const [visibleVisualCount, setVisibleVisualCount] = useState(() =>
    Math.min(visualFiles.length, INITIAL_VISUAL_RENDER_COUNT)
  );
  const [visibleFileListCount, setVisibleFileListCount] = useState(() =>
    Math.min(nonVisualFiles.length, INITIAL_FILE_LIST_RENDER_COUNT)
  );

  useEffect(() => {
    setVisibleVisualCount((prev) => Math.min(visualFiles.length, Math.max(prev, INITIAL_VISUAL_RENDER_COUNT)));
  }, [visualFiles.length]);

  useEffect(() => {
    setVisibleFileListCount((prev) =>
      Math.min(nonVisualFiles.length, Math.max(prev, INITIAL_FILE_LIST_RENDER_COUNT))
    );
  }, [nonVisualFiles.length]);

  const visibleVisualFiles =
    browseMode === "pages" ? visualFiles : visualFiles.slice(0, visibleVisualCount);
  const visibleNonVisualFiles =
    browseMode === "pages" ? nonVisualFiles : nonVisualFiles.slice(0, visibleFileListCount);
  const hiddenVisualCount =
    browseMode === "pages" ? 0 : Math.max(0, visualFiles.length - visibleVisualFiles.length);
  const hiddenNonVisualCount =
    browseMode === "pages" ? 0 : Math.max(0, nonVisualFiles.length - visibleNonVisualFiles.length);
  const selectedInFilteredCount = filteredFiles.reduce((sum, file) => sum + Number(selectedIds.has(file.id)), 0);
  const selectedInPageCount = pageFiles.reduce((sum, file) => sum + Number(selectedIds.has(file.id)), 0);
  const allFilteredSelected = filteredFiles.length > 0 && selectedInFilteredCount === filteredFiles.length;
  const allPageSelected = pageFiles.length > 0 && selectedInPageCount === pageFiles.length;

  const openLightbox = useCallback((index: number) => {
    setLightboxError(false);
    setLightboxIndex(index);
  }, []);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);

  const goNext = useCallback(() => {
    setLightboxError(false);
    setLightboxIndex((prev) => (prev !== null && prev < visualFiles.length - 1 ? prev + 1 : prev));
  }, [visualFiles.length]);

  const goPrev = useCallback(() => {
    setLightboxError(false);
    setLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
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
    return () => {
      document.body.style.overflow = "";
    };
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
            setDownloadProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : null));
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

  const selectFiltered = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const f of filteredFiles) next.add(f.id);
      return next;
    });
  }, [filteredFiles]);

  const selectPage = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const f of pageFiles) next.add(f.id);
      return next;
    });
  }, [pageFiles]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectedCount = selectedIds.size;
  const allSelected = files.length > 0 && selectedCount === files.length;

  const currentVisual = lightboxIndex !== null ? visualFiles[lightboxIndex] : null;

  const downloadLabel = downloadProgress ? `[ ${downloadProgress.done}/${downloadProgress.total} fetched... ]` : "[ zipping... ]";

  return (
    <div>
      {/* Filters + browsing mode */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-2 font-mono text-micro tracking-wide">
          {([
            ["all", "all"],
            ["photos", "photos"],
            ["videos", "videos"],
            ["files", "files"],
          ] as const).map(([key, label]) => {
            const isActive = activeFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveFilter(key)}
                className={
                  isActive
                    ? "px-2 py-1 rounded-sm border theme-border text-foreground"
                    : "px-2 py-1 rounded-sm border theme-border theme-muted hover:text-foreground transition-colors"
                }
              >
                [{label} {filterCounts[key]}]
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-micro tracking-wide">
          <span className="theme-muted">browse</span>
          <button
            type="button"
            onClick={() => setBrowseMode("scroll")}
            className={
              browseMode === "scroll"
                ? "px-2 py-1 rounded-sm border theme-border text-foreground"
                : "px-2 py-1 rounded-sm border theme-border theme-muted hover:text-foreground transition-colors"
            }
          >
            [scroll]
          </button>
          <button
            type="button"
            onClick={() => setBrowseMode("pages")}
            className={
              browseMode === "pages"
                ? "px-2 py-1 rounded-sm border theme-border text-foreground"
                : "px-2 py-1 rounded-sm border theme-border theme-muted hover:text-foreground transition-colors"
            }
          >
            [pages]
          </button>
          {browseMode === "pages" && !canPaginate && (
            <span className="theme-muted text-nano">single page</span>
          )}
        </div>
      </div>

      {browseMode === "pages" && canPaginate && (
        <div className="mb-4">
          <PageControls page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <span className="font-mono text-micro theme-muted tracking-wide">
          {selectedCount > 0
            ? `${selectedCount} selected (${selectedInFilteredCount} in current filter)`
            : browseMode === "pages" && canPaginate
              ? `showing ${pageFiles.length} of ${filteredFiles.length} in filter (${files.length} total)`
              : `${filteredFiles.length} ${filteredFiles.length === 1 ? "file" : "files"} in filter`}
        </span>
        <div className="flex items-center gap-3 font-mono text-micro tracking-wide">
          {selectedCount > 0 && (
            <>
              <button onClick={clearSelection} className="theme-muted hover:text-foreground transition-colors">
                [ clear ]
              </button>
              <button
                onClick={downloadSelected}
                disabled={downloading}
                className="text-amber-600 hover:text-amber-500 transition-colors disabled:opacity-50"
              >
                {downloading && downloadProgress && downloadProgress.total === selectedCount ? downloadLabel : "[ download selected ]"}
              </button>
            </>
          )}
          {!allPageSelected && browseMode === "pages" && pageFiles.length > 1 && (
            <button onClick={selectPage} className="theme-muted hover:text-foreground transition-colors">
              [ select page ]
            </button>
          )}
          {!allFilteredSelected && filteredFiles.length > 1 && (
            <button onClick={selectFiltered} className="theme-muted hover:text-foreground transition-colors">
              [ select filtered ]
            </button>
          )}
          {!allSelected && files.length > 1 && activeFilter !== "all" && (
            <button onClick={selectAll} className="theme-muted hover:text-foreground transition-colors">
              [ select all ]
            </button>
          )}
          <button
            onClick={downloadAll}
            disabled={downloading}
            className="text-amber-600 hover:text-amber-500 transition-colors disabled:opacity-50"
          >
            {downloading && (!downloadProgress || downloadProgress.total === files.length) ? downloadLabel : "[ download all ]"}
          </button>
        </div>
      </div>

      {/* Visual media grid (images, GIFs, videos) */}
      {visualFiles.length > 0 && (
        <>
          {hiddenVisualCount > 0 && browseMode === "scroll" && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-sm border theme-border px-3 py-2">
              <p className="font-mono text-nano theme-muted tracking-wide">
                Showing {visibleVisualFiles.length} of {visualFiles.length} visual items to keep this page responsive.
              </p>
              <div className="flex items-center gap-3 font-mono text-micro tracking-wide">
                <button
                  type="button"
                  onClick={() =>
                    setVisibleVisualCount((prev) => Math.min(visualFiles.length, prev + VISUAL_RENDER_INCREMENT))
                  }
                  className="theme-muted hover:text-foreground transition-colors"
                >
                  [ show {Math.min(VISUAL_RENDER_INCREMENT, hiddenVisualCount)} more ]
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleVisualCount(visualFiles.length)}
                  className="text-amber-600 hover:text-amber-500 transition-colors"
                >
                  [ show all ]
                </button>
              </div>
            </div>
          )}

          <div className="gallery-masonry">
            {visibleVisualFiles.map((file, index) => (
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
        </>
      )}

      {/* Non-visual files list (audio, documents, archives) */}
      {nonVisualFiles.length > 0 && (
        <div className={visualFiles.length > 0 ? "mt-8" : ""}>
          {visualFiles.length > 0 && (
            <p className="font-mono text-micro theme-muted tracking-wide mb-3">files</p>
          )}
          {hiddenNonVisualCount > 0 && browseMode === "scroll" && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-sm border theme-border px-3 py-2">
              <p className="font-mono text-nano theme-muted tracking-wide">
                Showing {visibleNonVisualFiles.length} of {nonVisualFiles.length} non-visual files.
              </p>
              <div className="flex items-center gap-3 font-mono text-micro tracking-wide">
                <button
                  type="button"
                  onClick={() =>
                    setVisibleFileListCount((prev) =>
                      Math.min(nonVisualFiles.length, prev + FILE_LIST_RENDER_INCREMENT)
                    )
                  }
                  className="theme-muted hover:text-foreground transition-colors"
                >
                  [ show {Math.min(FILE_LIST_RENDER_INCREMENT, hiddenNonVisualCount)} more ]
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleFileListCount(nonVisualFiles.length)}
                  className="text-amber-600 hover:text-amber-500 transition-colors"
                >
                  [ show all ]
                </button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {visibleNonVisualFiles.map((file) => (
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
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  className="text-white/20"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <p className="font-mono text-sm text-white/40 tracking-wide">failed to load {currentVisual.filename}</p>
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
                key={currentVisual.id}
                file={currentVisual}
                transferId={transferId}
                onError={() => setLightboxError(true)}
              />
            )}
          </div>

          {/* Controls — stop propagation so clicking nav/download doesn't close */}
          <div className="flex items-center justify-between mt-4 max-w-md w-full px-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-4 font-mono text-xs text-white/50">
              {lightboxIndex > 0 ? (
                <button onClick={goPrev} className="hover:text-white transition-colors" aria-label="Previous file">
                  ← prev
                </button>
              ) : (
                <span className="text-white/20">← prev</span>
              )}
              {lightboxIndex < visualFiles.length - 1 ? (
                <button onClick={goNext} className="hover:text-white transition-colors" aria-label="Next file">
                  next →
                </button>
              ) : (
                <span className="text-white/20">next →</span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <span className="font-mono text-micro text-white/30">
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

      {browseMode === "pages" && canPaginate && (
        <div className="mt-8">
          <PageControls page={page} totalPages={totalPages} onPageChange={setPage} />
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
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="theme-muted opacity-40"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
      <span className="font-mono text-nano theme-muted opacity-60 tracking-wide truncate max-w-[80%] px-2 text-center">
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
  const aspectRatio = file.width && file.height ? file.height / file.width : 9 / 16;

  const { loaded, errored, handleLoad, handleError, imgRef } = useLazyImage();

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
        aria-label={`Open ${file.filename}`}
      >
        {/* Selection toggle — stop propagation so card click opens lightbox */}
        <div className="absolute top-2 left-2 z-10" onClick={(e) => e.stopPropagation()} role="none">
          <SelectionToggle selected={isSelected} onToggle={onToggleSelect} variant="overlay" />
        </div>

        <div className="absolute inset-0 gallery-placeholder" />

        {hasThumbnail && !errored ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            src={thumbUrl}
            alt={file.filename}
            width={file.width}
            height={file.height}
            loading="lazy"
            decoding="async"
            onLoad={handleLoad}
            onError={handleError}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
          />
        ) : errored ? (
          <BrokenImageFallback filename={file.filename} />
        ) : (
          /* Video placeholder */
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="theme-muted"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span className="font-mono text-nano theme-muted tracking-wide truncate max-w-[90%] px-2">
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
            <span className="font-mono text-pico bg-black/50 text-white/80 px-1.5 py-0.5 rounded tracking-wider uppercase">
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
  const checkbox = <SelectionToggle selected={isSelected} onToggle={onToggleSelect} variant="surface" />;

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
          <audio src={getTransferFileUrl(transferId, file.filename)} controls preload="none" className="w-full mt-2 h-8" />
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="font-mono text-nano theme-muted">{formatBytes(file.size)}</span>
          <button onClick={onDownload} className="font-mono text-micro text-amber-600 hover:text-amber-500 transition-colors">
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
        <p className="font-mono text-nano theme-muted mt-0.5">
          {file.mimeType.split("/").pop()} · {formatBytes(file.size)}
        </p>
      </div>
      <button
        onClick={onDownload}
        className="font-mono text-micro text-amber-600 hover:text-amber-500 transition-colors shrink-0"
      >
        [ download ]
      </button>
    </div>
  );
}
