"use client";

import { useState, useCallback, useEffect, useMemo, memo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getTransferThumbUrl, getTransferFullUrl, getTransferStorageUrl } from "@/features/media/storage";
import { buildTransferVisualItems, type TransferVisualItem } from "@/features/transfers/live-photo";
import { fetchBlob, downloadBlob } from "@/lib/client/media-download";
import { formatBytes } from "@/lib/shared/format";
import { useLazyImage } from "@/hooks/useLazyImage";
import { useSwipe } from "@/hooks/useSwipe";
import { SelectionToggle } from "@/components/SelectionToggle";
import type { AssetGroup, FileKind } from "@/features/transfers/store";

/* ─── Types ─── */

type TransferFileData = {
  id: string;
  filename: string;
  kind: FileKind;
  size: number;
  mimeType: string;
  storageKey: string;
  originalStorageKey?: string;
  originalFilename?: string;
  convertedFrom?: "heic";
  width?: number;
  height?: number;
  takenAt?: string;
  livePhotoContentId?: string;
  groupId?: string;
  groupRole?: "primary" | "raw" | "motion";
  previewStatus?: "ready" | "original_only";
  processingStatus?: "pending" | "skipped" | "local_done" | "queued" | "processing" | "worker_done" | "failed";
};

type TransferGalleryProps = {
  transferId: string;
  files: TransferFileData[];
  groups?: AssetGroup[];
  deleteToken?: string;
};

type GalleryFilter = "all" | "photos" | "videos" | "audio" | "files";
type BrowseMode = "scroll" | "pages";
type LivePhotoMode = "paired" | "separate";
type VisualGalleryItem = TransferVisualItem<TransferFileData>;
type GalleryEntry =
  | { id: string; type: "visual"; item: VisualGalleryItem }
  | { id: string; type: "file"; file: TransferFileData };

const INITIAL_VISUAL_RENDER_COUNT = 120;
const VISUAL_RENDER_INCREMENT = 120;
const INITIAL_FILE_LIST_RENDER_COUNT = 80;
const FILE_LIST_RENDER_INCREMENT = 120;
const PAGE_SIZE = 120;
const PROCESSED_IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|tiff?)$/i;
const RAW_IMAGE_EXTENSIONS = /\.(dng|arw|cr2|cr3|nef|orf|raf|rw2|raw)$/i;

function hasProcessedImageVariants(file: TransferFileData): boolean {
  if (file.kind !== "image") return false;
  if (file.previewStatus === "ready") return true;
  if (file.processingStatus === "queued" || file.processingStatus === "processing" || file.processingStatus === "failed") {
    return false;
  }
  return (
    PROCESSED_IMAGE_EXTENSIONS.test(file.filename) ||
    (RAW_IMAGE_EXTENSIONS.test(file.filename) &&
      typeof file.width === "number" &&
      typeof file.height === "number")
  );
}

function canRenderOriginalVisual(file: TransferFileData): boolean {
  return file.kind === "image" && PROCESSED_IMAGE_EXTENSIONS.test(file.filename) && !RAW_IMAGE_EXTENSIONS.test(file.filename);
}

function isRawImage(file: TransferFileData): boolean {
  return RAW_IMAGE_EXTENSIONS.test(file.filename);
}

function isPhotoLike(file: TransferFileData): boolean {
  return file.kind === "image" || file.kind === "gif" || isRawImage(file);
}

function hasVisualThumbnail(file: TransferFileData): boolean {
  return (
    (file.kind === "video" && file.previewStatus === "ready" && typeof file.width === "number" && typeof file.height === "number") ||
    (file.kind === "gif" && file.previewStatus === "ready") ||
    hasProcessedImageVariants(file) ||
    canRenderOriginalVisual(file)
  );
}

function getOriginalVisualUrl(transferId: string, file: TransferFileData): string {
  return getTransferStorageUrl(file.storageKey);
}

function getDownloadUrl(file: TransferFileData): string {
  return getTransferStorageUrl(file.originalStorageKey ?? file.storageKey);
}

function getDownloadFilename(file: TransferFileData): string {
  return file.originalFilename ?? file.filename;
}

function getVisualItemFiles(item: VisualGalleryItem): TransferFileData[] {
  if (item.type === "single") return [item.file];
  if (item.type === "live_photo") return [item.photo, item.motion];
  return [item.primary, item.raw];
}

function getVisualItemPrimaryFile(item: VisualGalleryItem): TransferFileData {
  return item.type === "single" ? item.file : item.primary;
}

function getVisualItemLabel(item: VisualGalleryItem): string {
  if (item.type === "single") return item.file.filename;
  if (item.type === "live_photo") return item.photo.filename;
  return `${item.primary.filename} + ${item.raw.filename}`;
}

function shouldShowRawPreviewNotice(item: VisualGalleryItem): boolean {
  return item.type === "raw_pair" || isRawImage(getVisualItemPrimaryFile(item));
}

function getVisualLoadFailureMessage(file: TransferFileData): string {
  if (file.processingStatus === "queued" || file.processingStatus === "processing") {
    return "Preview is still processing. Wait a moment, then reload the page or download the original file.";
  }

  if (file.processingStatus === "failed") {
    return "Preview generation failed for this file. Download the original file instead.";
  }

  if (file.previewStatus === "original_only") {
    return "No browser preview is available for this file type. Download the original file instead.";
  }

  if (file.kind === "video") {
    return "This video could not be loaded in the browser. Download the original file instead.";
  }

  return "This preview could not be loaded. The preview asset or original file may be missing. Try downloading the original file instead.";
}

function isVisualItemSelected(item: VisualGalleryItem, selectedIds: Set<string>): boolean {
  return getVisualItemFiles(item).every((file) => selectedIds.has(file.id));
}

function isGalleryFilter(value: string | null): value is GalleryFilter {
  return value === "all" || value === "photos" || value === "videos" || value === "audio" || value === "files";
}

function isBrowseMode(value: string | null): value is BrowseMode {
  return value === "scroll" || value === "pages";
}

function getScopeSelectLabel(filter: GalleryFilter): string {
  if (filter === "all") return "[ select all ]";
  if (filter === "photos") return "[ select all photos ]";
  if (filter === "videos") return "[ select all videos ]";
  if (filter === "audio") return "[ select all audio ]";
  return "[ select all files ]";
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

function SingleVisualContent({
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
        src={getTransferStorageUrl(file.storageKey)}
        poster={file.previewStatus === "ready" ? getTransferFullUrl(transferId, file.id) : undefined}
        controls
        autoPlay
        className="max-w-full max-h-media photo-page-fade-in"
        style={{ objectFit: "contain" }}
        onClick={(e) => e.stopPropagation()}
        onError={onError}
      />
    );
  }

  if (file.previewStatus !== "ready" && !canRenderOriginalVisual(file)) {
    const label =
      file.processingStatus === "queued" || file.processingStatus === "processing"
        ? "processing preview..."
        : "preview unavailable";
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 px-8" onClick={(e) => e.stopPropagation()}>
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          className="text-white/20"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <p className="font-mono text-xs text-white/40 tracking-wide">{label}</p>
      </div>
    );
  }

  const imgSrc =
    file.kind === "gif"
      ? getTransferStorageUrl(file.storageKey)
      : hasProcessedImageVariants(file)
        ? getTransferFullUrl(transferId, file.id)
        : getTransferStorageUrl(file.storageKey);

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

function LightboxContent({
  item,
  transferId,
  onError,
  onActiveFileChange,
}: {
  item: VisualGalleryItem;
  transferId: string;
  onError: () => void;
  onActiveFileChange?: (file: TransferFileData) => void;
}) {
  if (item.type === "single") {
    return <SingleVisualContent file={item.file} transferId={transferId} onError={onError} />;
  }

  return (
    <MultiVisualContent
      key={item.id}
      item={item}
      transferId={transferId}
      onError={onError}
      onActiveFileChange={onActiveFileChange}
    />
  );
}

function MultiVisualContent({
  item,
  transferId,
  onError,
  onActiveFileChange,
}: {
  item: Exclude<VisualGalleryItem, { type: "single" }>;
  transferId: string;
  onError: () => void;
  onActiveFileChange?: (file: TransferFileData) => void;
}) {
  const [activePanel, setActivePanel] = useState<"primary" | "secondary">("primary");

  const showing =
    item.type === "live_photo"
      ? activePanel === "primary"
        ? item.photo
        : item.motion
      : activePanel === "primary"
        ? item.primary
        : item.raw;

  useEffect(() => {
    onActiveFileChange?.(showing);
  }, [onActiveFileChange, showing]);

  return (
    <div className="flex flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 font-mono text-micro tracking-wide">
        <span className="text-white/35">{item.type === "live_photo" ? "live photo" : "raw pair"}</span>
        <button
          type="button"
          onClick={() => setActivePanel("primary")}
          className={
            activePanel === "primary"
              ? "px-2 py-1 rounded-sm border border-white/30 text-white"
              : "px-2 py-1 rounded-sm border border-white/15 text-white/50 hover:text-white transition-colors"
          }
        >
          [{item.type === "live_photo" ? "photo" : "preview"}]
        </button>
        <button
          type="button"
          onClick={() => setActivePanel("secondary")}
          className={
            activePanel === "secondary"
              ? "px-2 py-1 rounded-sm border border-white/30 text-white"
              : "px-2 py-1 rounded-sm border border-white/15 text-white/50 hover:text-white transition-colors"
          }
        >
          [{item.type === "live_photo" ? "motion" : "raw"}]
        </button>
      </div>
      <SingleVisualContent file={showing} transferId={transferId} onError={onError} />
      <p className="font-mono text-nano text-white/35 tracking-wide text-center">
        {item.type === "live_photo"
          ? `${item.photo.filename} + ${item.motion.filename}`
          : `${item.primary.filename} + ${item.raw.filename}`}
      </p>
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
export function TransferGallery({ transferId, files, groups, deleteToken }: TransferGalleryProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentFiles, setCurrentFiles] = useState(files);
  const [currentGroups, setCurrentGroups] = useState(groups);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ done: number; total: number } | null>(null);
  const [savingSingle, setSavingSingle] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [lightboxError, setLightboxError] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [activeFilter, setActiveFilter] = useState<GalleryFilter>(() => {
    const raw = searchParams.get("filter");
    return isGalleryFilter(raw) ? raw : "all";
  });
  const [browseMode, setBrowseMode] = useState<BrowseMode>(() => {
    const raw = searchParams.get("view");
    return isBrowseMode(raw) ? raw : "scroll";
  });
  const [livePhotoMode, setLivePhotoMode] = useState<LivePhotoMode>(() => {
    const raw = searchParams.get("live");
    return raw === "separate" ? "separate" : "paired";
  });
  const [page, setPage] = useState(() => {
    const raw = Number(searchParams.get("page"));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
  });

  useEffect(() => {
    setCurrentFiles(files);
  }, [files]);

  useEffect(() => {
    setCurrentGroups(groups);
  }, [groups]);

  const grouped = useMemo(() => {
    const photos: TransferFileData[] = [];
    const videos: TransferFileData[] = [];
    const audio: TransferFileData[] = [];
    const fileOnly: TransferFileData[] = [];
    const visual: TransferFileData[] = [];

    for (const file of currentFiles) {
      if (isPhotoLike(file)) {
        photos.push(file);
        visual.push(file);
        continue;
      }
      if (file.kind === "video") {
        videos.push(file);
        visual.push(file);
        continue;
      }
      if (file.kind === "audio") {
        audio.push(file);
        continue;
      }
      fileOnly.push(file);
    }

    return { photos, videos, audio, fileOnly, visual };
  }, [currentFiles]);

  const filterCounts = useMemo(
    () => ({
      all: currentFiles.length,
      photos: grouped.photos.length,
      videos: grouped.videos.length,
      audio: grouped.audio.length,
      files: grouped.fileOnly.length,
    }),
    [currentFiles.length, grouped]
  );
  const pairedVisualItems = useMemo(
    () => buildTransferVisualItems(grouped.visual, currentGroups),
    [grouped.visual, currentGroups]
  );
  const hasGroupedVisualItems = useMemo(
    () => pairedVisualItems.some((item) => item.type !== "single"),
    [pairedVisualItems]
  );

  useEffect(() => {
    function syncFromLocation() {
      const current = new URLSearchParams(window.location.search);
      const nextFilterRaw = current.get("filter");
      const nextFilter = isGalleryFilter(nextFilterRaw) ? nextFilterRaw : "all";
      setActiveFilter((prev) => (prev === nextFilter ? prev : nextFilter));

      const nextViewRaw = current.get("view");
      const nextView = isBrowseMode(nextViewRaw) ? nextViewRaw : "scroll";
      setBrowseMode((prev) => (prev === nextView ? prev : nextView));

      const nextLiveRaw = current.get("live");
      const nextLive = nextLiveRaw === "separate" ? "separate" : "paired";
      setLivePhotoMode((prev) => (prev === nextLive ? prev : nextLive));

      const nextPageRaw = Number(current.get("page"));
      const nextPage =
        Number.isFinite(nextPageRaw) && nextPageRaw > 0 ? Math.floor(nextPageRaw) : 1;
      setPage((prev) => (prev === nextPage ? prev : nextPage));
    }

    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, []);

  const filteredEntries = useMemo(() => {
    const separateVisualItems = grouped.visual.map(
      (file) => ({ id: `single:${file.id}`, type: "single", file } as const satisfies VisualGalleryItem)
    );
    const separatePhotoItems = grouped.photos.map(
      (file) => ({ id: `single:${file.id}`, type: "single", file } as const satisfies VisualGalleryItem)
    );
    const separateVideoItems = grouped.videos.map(
      (file) => ({ id: `single:${file.id}`, type: "single", file } as const satisfies VisualGalleryItem)
    );

    const visualItems =
      activeFilter === "all"
        ? livePhotoMode === "paired" ? pairedVisualItems : separateVisualItems
        : activeFilter === "photos"
          ? livePhotoMode === "paired"
            ? pairedVisualItems.filter((item) => isPhotoLike(getVisualItemPrimaryFile(item)))
            : separatePhotoItems
          : activeFilter === "videos"
            ? separateVideoItems
            : [];

    const fileEntries =
      activeFilter === "all"
        ? [...grouped.audio, ...grouped.fileOnly]
        : activeFilter === "audio"
          ? grouped.audio
          : activeFilter === "files"
            ? grouped.fileOnly
            : [];

    return [
      ...visualItems.map((item) => ({ id: item.id, type: "visual", item } as const satisfies GalleryEntry)),
      ...fileEntries.map((file) => ({ id: `file:${file.id}`, type: "file", file } as const satisfies GalleryEntry)),
    ];
  }, [activeFilter, grouped, livePhotoMode, pairedVisualItems]);
  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const canPaginate = filteredEntries.length > PAGE_SIZE;

  useEffect(() => {
    if (
      activeFilter !== "all" &&
      activeFilter !== "videos" &&
      (filterCounts[activeFilter] === 0 || filterCounts[activeFilter] === filterCounts.all)
    ) {
      setActiveFilter("all");
    }
  }, [activeFilter, filterCounts]);

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  const pageStartIndex = browseMode === "pages" ? (page - 1) * PAGE_SIZE : 0;
  const pageEntries = useMemo(
    () =>
      browseMode === "pages"
        ? filteredEntries.slice(pageStartIndex, pageStartIndex + PAGE_SIZE)
        : filteredEntries,
    [browseMode, filteredEntries, pageStartIndex]
  );

  const { visualItems, nonVisualFiles } = useMemo(() => {
    const visual: VisualGalleryItem[] = [];
    const nonVisual: TransferFileData[] = [];
    for (const entry of pageEntries) {
      if (entry.type === "visual") visual.push(entry.item);
      else nonVisual.push(entry.file);
    }
    return { visualItems: visual, nonVisualFiles: nonVisual };
  }, [pageEntries]);
  const [visibleVisualCount, setVisibleVisualCount] = useState(() =>
    Math.min(visualItems.length, INITIAL_VISUAL_RENDER_COUNT)
  );
  const [visibleFileListCount, setVisibleFileListCount] = useState(() =>
    Math.min(nonVisualFiles.length, INITIAL_FILE_LIST_RENDER_COUNT)
  );

  useEffect(() => {
    setVisibleVisualCount((prev) => Math.min(visualItems.length, Math.max(prev, INITIAL_VISUAL_RENDER_COUNT)));
  }, [visualItems.length]);

  useEffect(() => {
    setVisibleFileListCount((prev) =>
      Math.min(nonVisualFiles.length, Math.max(prev, INITIAL_FILE_LIST_RENDER_COUNT))
    );
  }, [nonVisualFiles.length]);

  useEffect(() => {
    const allowedIds = new Set(currentFiles.map((file) => file.id));
    setSelectedIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => allowedIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [currentFiles]);

  const visibleVisualFiles =
    browseMode === "pages" ? visualItems : visualItems.slice(0, visibleVisualCount);
  const visibleNonVisualFiles =
    browseMode === "pages" ? nonVisualFiles : nonVisualFiles.slice(0, visibleFileListCount);
  const hiddenVisualCount =
    browseMode === "pages" ? 0 : Math.max(0, visualItems.length - visibleVisualFiles.length);
  const hiddenNonVisualCount =
    browseMode === "pages" ? 0 : Math.max(0, nonVisualFiles.length - visibleNonVisualFiles.length);
  const selectedInFilteredCount = useMemo(
    () =>
      filteredEntries.reduce((sum, entry) => {
        if (entry.type === "visual") return sum + Number(isVisualItemSelected(entry.item, selectedIds));
        return sum + Number(selectedIds.has(entry.file.id));
      }, 0),
    [filteredEntries, selectedIds]
  );
  const selectedInPageCount = useMemo(
    () =>
      pageEntries.reduce((sum, entry) => {
        if (entry.type === "visual") return sum + Number(isVisualItemSelected(entry.item, selectedIds));
        return sum + Number(selectedIds.has(entry.file.id));
      }, 0),
    [pageEntries, selectedIds]
  );
  const allFilteredSelected = filteredEntries.length > 0 && selectedInFilteredCount === filteredEntries.length;
  const allPageSelected = pageEntries.length > 0 && selectedInPageCount === pageEntries.length;
  const lightboxVisualFiles = useMemo(() => {
    if (activeFilter === "all") {
      return livePhotoMode === "paired"
        ? pairedVisualItems
        : grouped.visual.map((file) => ({ id: `single:${file.id}`, type: "single", file } as const satisfies VisualGalleryItem));
    }
    if (activeFilter === "photos") {
      return livePhotoMode === "paired"
        ? pairedVisualItems.filter((item) => isPhotoLike(getVisualItemPrimaryFile(item)))
        : grouped.photos.map((file) => ({ id: `single:${file.id}`, type: "single", file } as const satisfies VisualGalleryItem));
    }
    if (activeFilter === "videos") {
      return grouped.videos.map((file) => ({ id: `single:${file.id}`, type: "single", file } as const satisfies VisualGalleryItem));
    }
    return [] as VisualGalleryItem[];
  }, [activeFilter, grouped, livePhotoMode, pairedVisualItems]);
  const lightboxVisualIndexById = useMemo(
    () => new Map(lightboxVisualFiles.map((item, index) => [item.id, index])),
    [lightboxVisualFiles]
  );

  useEffect(() => {
    const currentQuery = window.location.search.replace(/^\?/, "");
    const next = new URLSearchParams(window.location.search);
    if (activeFilter === "all") next.delete("filter");
    else next.set("filter", activeFilter);

    if (browseMode === "scroll") next.delete("view");
    else next.set("view", browseMode);

    if (livePhotoMode === "paired") next.delete("live");
    else next.set("live", livePhotoMode);

    if (browseMode === "pages" && page > 1) next.set("page", String(page));
    else next.delete("page");

    const nextQuery = next.toString();
    if (nextQuery !== currentQuery) {
      window.history.replaceState(
        window.history.state,
        "",
        nextQuery ? `${pathname}?${nextQuery}` : pathname
      );
    }
  }, [activeFilter, browseMode, livePhotoMode, page, pathname]);

  const handleFilterChange = useCallback(
    (nextFilter: GalleryFilter) => {
      if (nextFilter === activeFilter) return;
      setLightboxIndex(null);
      setActiveFilter(nextFilter);
      setPage(1);
    },
    [activeFilter]
  );

  const handleBrowseModeChange = useCallback(
    (nextMode: BrowseMode) => {
      if (nextMode === browseMode) return;
      setBrowseMode(nextMode);
      setPage(1);
    },
    [browseMode]
  );

  const handleLivePhotoModeChange = useCallback(
    (nextMode: LivePhotoMode) => {
      if (nextMode === livePhotoMode) return;
      setLightboxIndex(null);
      setLivePhotoMode(nextMode);
      setPage(1);
    },
    [livePhotoMode]
  );

  const handlePageChange = useCallback(
    (nextPage: number) => {
      setPage(Math.max(1, Math.min(nextPage, totalPages)));
    },
    [totalPages]
  );

  const openLightbox = useCallback((index: number) => {
    setLightboxError(false);
    setLightboxIndex(index);
  }, []);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);

  const goNext = useCallback(() => {
    setLightboxError(false);
    setLightboxIndex((prev) => (prev !== null && prev < lightboxVisualFiles.length - 1 ? prev + 1 : prev));
  }, [lightboxVisualFiles.length]);

  const goPrev = useCallback(() => {
    setLightboxError(false);
    setLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
  }, []);

  // Preload adjacent full-size visuals for smoother lightbox navigation.
  useEffect(() => {
    if (lightboxIndex === null) return;

    const candidates = [lightboxVisualFiles[lightboxIndex - 1], lightboxVisualFiles[lightboxIndex + 1]].filter(
      (item): item is VisualGalleryItem => !!item
    );

    for (const item of candidates) {
      const file = getVisualItemPrimaryFile(item);
      if (file.kind === "gif") continue;
      if (file.kind !== "image" && file.kind !== "video") continue;
      const img = new Image();
      img.decoding = "async";
      img.src = getTransferFullUrl(transferId, file.id);
    }
  }, [lightboxIndex, lightboxVisualFiles, transferId]);

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
        const blob = await fetchBlob(getDownloadUrl(file));
        downloadBlob(blob, getDownloadFilename(file));
      } catch (err) {
        console.error("Download failed:", err);
      } finally {
        setSavingSingle(false);
      }
    },
    [savingSingle]
  );

  /** Download a subset of files (zip or single) */
  const downloadFiles = useCallback(
    async (filesToDownload: TransferFileData[]) => {
      if (downloading || filesToDownload.length === 0) return;
      setDownloading(true);
      try {
        if (filesToDownload.length === 1) {
          const blob = await fetchBlob(getDownloadUrl(filesToDownload[0]));
          downloadBlob(blob, getDownloadFilename(filesToDownload[0]));
          return;
        }

        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        setDownloadProgress({ done: 0, total: filesToDownload.length });

        await Promise.all(
          filesToDownload.map(async (f) => {
            const blob = await fetchBlob(getDownloadUrl(f));
            zip.file(getDownloadFilename(f), blob);
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
    if (currentFiles.length === 0) return;
    downloadFiles(currentFiles);
  }, [currentFiles, downloadFiles]);

  const downloadVisualItem = useCallback(
    async (item: VisualGalleryItem) => {
      await downloadFiles(getVisualItemFiles(item));
    },
    [downloadFiles]
  );

  /** Download only selected files */
  const downloadSelected = useCallback(() => {
    const selected = currentFiles.filter((f) => selectedIds.has(f.id));
    if (selected.length === 0) return;
    downloadFiles(selected);
  }, [currentFiles, selectedIds, downloadFiles]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleVisualItemSelection = useCallback((item: VisualGalleryItem) => {
    const itemIds = getVisualItemFiles(item).map((file) => file.id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const shouldSelect = itemIds.some((id) => !next.has(id));
      for (const id of itemIds) {
        if (shouldSelect) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const selectFiltered = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const entry of filteredEntries) {
        if (entry.type === "visual") {
          for (const file of getVisualItemFiles(entry.item)) next.add(file.id);
        } else {
          next.add(entry.file.id);
        }
      }
      return next;
    });
  }, [filteredEntries]);

  const selectPage = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const entry of pageEntries) {
        if (entry.type === "visual") {
          for (const file of getVisualItemFiles(entry.item)) next.add(file.id);
        } else {
          next.add(entry.file.id);
        }
      }
      return next;
    });
  }, [pageEntries]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);
  const [activeLightboxFile, setActiveLightboxFile] = useState<TransferFileData | null>(null);

  const handleDeleteFile = useCallback(
    async (file: TransferFileData) => {
      if (!deleteToken || deletingFileId) return;
      const confirmed = window.confirm(`Delete "${file.filename}" from this transfer?`);
      if (!confirmed) return;

      setDeleteError("");
      setDeletingFileId(file.id);

      try {
        const res = await fetch(`/api/transfers/${transferId}/files/${encodeURIComponent(file.id)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: deleteToken }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          setDeleteError(typeof data?.error === "string" ? data.error : "Delete failed.");
          return;
        }

        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(file.id);
          return next;
        });
        setLightboxError(false);
        setLightboxIndex(null);

        if (data.deletedTransfer) {
          router.replace("/");
          router.refresh();
          return;
        }

        if (data.transfer) {
          setCurrentFiles(data.transfer.files as TransferFileData[]);
          setCurrentGroups((data.transfer.groups as AssetGroup[] | undefined) ?? undefined);
        } else {
          setCurrentFiles((prev) => prev.filter((candidate) => candidate.id !== file.id));
          setCurrentGroups((prev) => prev);
        }
      } catch {
        setDeleteError("Connection error. Try again.");
      } finally {
        setDeletingFileId(null);
      }
    },
    [deleteToken, deletingFileId, router, transferId]
  );

  const selectedCount = selectedIds.size;
  const selectedDisplayCount = selectedInFilteredCount;
  const currentVisual = lightboxIndex !== null ? lightboxVisualFiles[lightboxIndex] : null;
  useEffect(() => {
    if (!currentVisual) setActiveLightboxFile(null);
  }, [currentVisual]);
  const visibleFilterTabs = ([
    { key: "all", label: "all", count: filterCounts.all },
    { key: "photos", label: "photos", count: filterCounts.photos },
    { key: "videos", label: "videos", count: filterCounts.videos },
    { key: "audio", label: "audio", count: filterCounts.audio },
    { key: "files", label: "files", count: filterCounts.files },
  ] as const).filter(
    (tab) => tab.key === "all" || (tab.count > 0 && tab.count < filterCounts.all)
  );

  const downloadLabel = downloadProgress ? `[ ${downloadProgress.done}/${downloadProgress.total} fetched... ]` : "[ zipping... ]";

  return (
    <div>
      {/* Filters + browsing mode */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-2 font-mono text-micro tracking-wide">
          {visibleFilterTabs.map(({ key, label, count }) => {
            const isActive = activeFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleFilterChange(key)}
                className={
                  isActive
                    ? "px-2 py-1 rounded-sm border theme-border text-foreground"
                    : "px-2 py-1 rounded-sm border theme-border theme-muted hover:text-foreground transition-colors"
                }
              >
                [{label} {count}]
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-micro tracking-wide">
          {hasGroupedVisualItems && (activeFilter === "all" || activeFilter === "photos") && (
            <>
              <span className="theme-muted">grouped</span>
              <button
                type="button"
                onClick={() => handleLivePhotoModeChange("paired")}
                className={
                  livePhotoMode === "paired"
                    ? "px-2 py-1 rounded-sm border theme-border text-foreground"
                    : "px-2 py-1 rounded-sm border theme-border theme-muted hover:text-foreground transition-colors"
                }
              >
                [paired]
              </button>
              <button
                type="button"
                onClick={() => handleLivePhotoModeChange("separate")}
                className={
                  livePhotoMode === "separate"
                    ? "px-2 py-1 rounded-sm border theme-border text-foreground"
                    : "px-2 py-1 rounded-sm border theme-border theme-muted hover:text-foreground transition-colors"
                }
              >
                [separate]
              </button>
            </>
          )}
          <span className="theme-muted">browse</span>
          <button
            type="button"
            onClick={() => handleBrowseModeChange("scroll")}
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
            onClick={() => handleBrowseModeChange("pages")}
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
          <PageControls page={page} totalPages={totalPages} onPageChange={handlePageChange} />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <span className="font-mono text-micro theme-muted tracking-wide">
          {selectedCount > 0
            ? `${selectedDisplayCount} selected in current view`
            : browseMode === "pages" && canPaginate
              ? `showing ${pageEntries.length} of ${filteredEntries.length} in filter (${currentFiles.length} files total)`
              : `${filteredEntries.length} ${filteredEntries.length === 1 ? "item" : "items"} in filter`}
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
          {!allPageSelected && browseMode === "pages" && pageEntries.length > 1 && (
            <button onClick={selectPage} className="theme-muted hover:text-foreground transition-colors">
              [ select page ]
            </button>
          )}
          {!allFilteredSelected && filteredEntries.length > 1 && (
            <button onClick={selectFiltered} className="theme-muted hover:text-foreground transition-colors">
              {getScopeSelectLabel(activeFilter)}
            </button>
          )}
          <button
            onClick={downloadAll}
            disabled={downloading}
            className="text-amber-600 hover:text-amber-500 transition-colors disabled:opacity-50"
          >
            {downloading && (!downloadProgress || downloadProgress.total === currentFiles.length) ? downloadLabel : "[ download all ]"}
          </button>
        </div>
      </div>
      {deleteError ? (
        <p className="mb-4 font-mono text-micro tracking-wide text-red-600">
          {deleteError}
        </p>
      ) : null}

      {/* Visual media grid (images, GIFs, videos) */}
      {visualItems.length > 0 && (
        <>
          {hiddenVisualCount > 0 && browseMode === "scroll" && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-sm border theme-border px-3 py-2">
              <p className="font-mono text-nano theme-muted tracking-wide">
                Showing {visibleVisualFiles.length} of {visualItems.length} visual items to keep this page responsive.
              </p>
              <div className="flex items-center gap-3 font-mono text-micro tracking-wide">
                <button
                  type="button"
                  onClick={() =>
                    setVisibleVisualCount((prev) => Math.min(visualItems.length, prev + VISUAL_RENDER_INCREMENT))
                  }
                  className="theme-muted hover:text-foreground transition-colors"
                >
                  [ show {Math.min(VISUAL_RENDER_INCREMENT, hiddenVisualCount)} more ]
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleVisualCount(visualItems.length)}
                  className="text-amber-600 hover:text-amber-500 transition-colors"
                >
                  [ show all ]
                </button>
              </div>
            </div>
          )}

          <div className="gallery-masonry">
            {visibleVisualFiles.map((item, index) => (
              <VisualCard
                key={item.id}
                transferId={transferId}
                item={item}
                isSelected={isVisualItemSelected(item, selectedIds)}
                onToggleSelect={() => toggleVisualItemSelection(item)}
                onClick={() => openLightbox(lightboxVisualIndexById.get(item.id) ?? index)}
              />
            ))}
          </div>
        </>
      )}

      {/* Non-visual files list (audio, documents, archives) */}
      {nonVisualFiles.length > 0 && (
        <div className={visualItems.length > 0 ? "mt-8" : ""}>
          {visualItems.length > 0 && (
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
                file={file}
                isSelected={selectedIds.has(file.id)}
                onToggleSelect={() => toggleSelection(file.id)}
                onDownload={() => downloadSingle(file)}
                onDelete={deleteToken ? () => handleDeleteFile(file) : undefined}
                deleting={deletingFileId === file.id}
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
                <p className="font-mono text-sm text-white/40 tracking-wide">
                  could not load {getVisualItemLabel(currentVisual)}
                </p>
                <p className="max-w-sm text-center font-mono text-xs text-white/30 leading-relaxed">
                  {getVisualLoadFailureMessage(getVisualItemPrimaryFile(currentVisual))}
                </p>
                <button
                  onClick={() => downloadVisualItem(currentVisual)}
                  disabled={savingSingle}
                  className="font-mono text-xs text-amber-500 hover:text-amber-400 transition-colors"
                >
                  [ try downloading instead ]
                </button>
              </div>
            ) : (
              <LightboxContent
                key={currentVisual.id}
                item={currentVisual}
                transferId={transferId}
                onError={() => setLightboxError(true)}
                onActiveFileChange={setActiveLightboxFile}
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
              {lightboxIndex < lightboxVisualFiles.length - 1 ? (
                <button onClick={goNext} className="hover:text-white transition-colors" aria-label="Next file">
                  next →
                </button>
              ) : (
                <span className="text-white/20">next →</span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <span className="font-mono text-micro text-white/30">
                {lightboxIndex + 1} / {lightboxVisualFiles.length}
              </span>
              {deleteToken && activeLightboxFile && (
                <button
                  onClick={() => handleDeleteFile(activeLightboxFile)}
                  disabled={deletingFileId === activeLightboxFile.id}
                  className="font-mono text-xs text-red-400/80 hover:text-red-300 transition-colors disabled:opacity-50"
                >
                  {deletingFileId === activeLightboxFile.id ? "deleting..." : "delete file"}
                </button>
              )}
              <button
                onClick={() => downloadVisualItem(currentVisual)}
                disabled={savingSingle}
                className="font-mono text-xs text-white/50 hover:text-white transition-colors disabled:opacity-50"
              >
                {savingSingle ? "saving..." : currentVisual.type === "single" ? "download ↓" : "download pair ↓"}
              </button>
            </div>
          </div>
          {shouldShowRawPreviewNotice(currentVisual) ? (
            <p
              className="mt-3 max-w-md px-4 text-center font-mono text-nano tracking-wide text-white/45"
              onClick={(e) => e.stopPropagation()}
            >
              RAW previews may differ slightly from the original. Download the source file for full-quality editing and accurate color.
            </p>
          ) : null}
          {deleteError ? (
            <p
              className="mt-3 max-w-md px-4 text-center font-mono text-nano tracking-wide text-red-300/80"
              onClick={(e) => e.stopPropagation()}
            >
              {deleteError}
            </p>
          ) : null}
        </div>
      )}

      {browseMode === "pages" && canPaginate && (
        <div className="mt-8">
          <PageControls page={page} totalPages={totalPages} onPageChange={handlePageChange} />
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
      <span className="font-mono text-[10px] theme-muted opacity-60 tracking-wide uppercase">
        preview unavailable
      </span>
      <span className="font-mono text-nano theme-muted opacity-60 tracking-wide truncate max-w-[80%] px-2 text-center">
        {filename}
      </span>
    </div>
  );
}

const VisualCard = memo(function VisualCard({
  transferId,
  item,
  isSelected,
  onToggleSelect,
  onClick,
}: {
  transferId: string;
  item: VisualGalleryItem;
  isSelected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
}) {
  const file = getVisualItemPrimaryFile(item);
  const hasThumbnail = hasVisualThumbnail(file);
  const primaryThumbUrl =
    file.kind === "video" || file.kind === "gif"
      ? getTransferThumbUrl(transferId, file.id)
      : hasProcessedImageVariants(file)
        ? getTransferThumbUrl(transferId, file.id)
        : canRenderOriginalVisual(file)
          ? getTransferStorageUrl(file.storageKey)
          : "";
  const [thumbUrl, setThumbUrl] = useState(primaryThumbUrl);
  const aspectRatio = file.width && file.height ? file.height / file.width : 9 / 16;

  const { loaded, errored, handleLoad, handleError, imgRef } = useLazyImage();

  useEffect(() => {
    setThumbUrl(primaryThumbUrl);
  }, [primaryThumbUrl]);

  const handleVisualError = useCallback(() => {
    const originalUrl = getOriginalVisualUrl(transferId, file);
    if (
      thumbUrl &&
      thumbUrl !== originalUrl &&
      file.kind !== "video" &&
      canRenderOriginalVisual(file)
    ) {
      setThumbUrl(originalUrl);
      return;
    }
    handleError();
  }, [file, handleError, thumbUrl, transferId]);

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
        aria-label={`Open ${item.type === "single" ? file.filename : getVisualItemLabel(item)}`}
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
            onError={handleVisualError}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
          />
        ) : errored ? (
          <BrokenImageFallback filename={file.filename} />
        ) : (
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
        {(file.kind === "video" || item.type === "live_photo") && hasThumbnail && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white" stroke="none">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
          </div>
        )}

        {item.type !== "single" && (
          <>
            <div className="absolute top-2 right-2 z-10">
              <span className="font-mono text-pico bg-black/50 text-white/80 px-1.5 py-0.5 rounded tracking-wider uppercase">
                linked
              </span>
            </div>
            <div className="absolute left-2 right-2 bottom-8 z-10">
              <span className="inline-block font-mono text-pico bg-black/55 text-white/85 px-1.5 py-0.5 rounded tracking-wider uppercase">
                {item.type === "live_photo" ? "photo + motion" : "preview + raw"}
              </span>
            </div>
          </>
        )}

        {/* GIF badge */}
        {file.kind === "gif" && (
          <div className="absolute bottom-2 left-2">
            <span className="font-mono text-pico bg-black/50 text-white/80 px-1.5 py-0.5 rounded tracking-wider uppercase">
              gif
            </span>
          </div>
        )}

        {isRawImage(file) && (
          <div className="absolute bottom-2 left-2">
            <span className="font-mono text-pico bg-black/50 text-white/80 px-1.5 py-0.5 rounded tracking-wider uppercase">
              {file.previewStatus === "ready" ? "raw preview" : "raw"}
            </span>
          </div>
        )}

        {file.convertedFrom && !isRawImage(file) && (
          <div className="absolute bottom-2 left-2">
            <span className="font-mono text-pico bg-black/50 text-white/80 px-1.5 py-0.5 rounded tracking-wider uppercase">
              {item.type === "live_photo" ? "live" : "optimized"}
            </span>
          </div>
        )}

        {item.type === "live_photo" && file.convertedFrom !== "heic" && (
          <div className="absolute bottom-2 left-2">
            <span className="font-mono text-pico bg-black/50 text-white/80 px-1.5 py-0.5 rounded tracking-wider uppercase">
              live
            </span>
          </div>
        )}

        {item.type === "raw_pair" && (
          <div className="absolute bottom-2 left-2">
            <span className="font-mono text-pico bg-black/50 text-white/80 px-1.5 py-0.5 rounded tracking-wider uppercase">
              raw pair
            </span>
          </div>
        )}

        {(file.processingStatus === "queued" || file.processingStatus === "processing") && (
          <div className="absolute bottom-2 right-2">
            <span className="font-mono text-pico bg-black/50 text-white/80 px-1.5 py-0.5 rounded tracking-wider uppercase">
              processing
            </span>
          </div>
        )}

        {file.processingStatus === "failed" && (
          <div className="absolute bottom-2 right-2">
            <span className="font-mono text-pico bg-black/50 text-white/80 px-1.5 py-0.5 rounded tracking-wider uppercase">
              original only
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
  file,
  isSelected,
  onToggleSelect,
  onDownload,
  onDelete,
  deleting,
}: {
  file: TransferFileData;
  isSelected: boolean;
  onToggleSelect: () => void;
  onDownload: () => void;
  onDelete?: () => void;
  deleting?: boolean;
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
          <audio src={getTransferStorageUrl(file.storageKey)} controls preload="none" className="w-full mt-2 h-8" />
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="font-mono text-nano theme-muted">{formatBytes(file.size)}</span>
          {onDelete && (
            <button
              onClick={onDelete}
              disabled={deleting}
              className="font-mono text-micro text-red-500/80 hover:text-red-400 transition-colors disabled:opacity-50"
            >
              {deleting ? "..." : "x"}
            </button>
          )}
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
      <div className="flex items-center gap-3 shrink-0">
        {onDelete && (
          <button
            onClick={onDelete}
            disabled={deleting}
            className="font-mono text-micro text-red-500/80 hover:text-red-400 transition-colors disabled:opacity-50"
          >
            {deleting ? "[ deleting ]" : "[ delete ]"}
          </button>
        )}
        <button
          onClick={onDownload}
          className="font-mono text-micro text-amber-600 hover:text-amber-500 transition-colors"
        >
          [ download ]
        </button>
      </div>
    </div>
  );
}
