import { useEffect, useCallback, useState, useRef } from "react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { getStored, setStored } from "@/lib/client/storage";
import { useSwipe } from "@/hooks/useSwipe";
import { downloadFile, type SingleFileDownloadProgress } from "@/lib/client/media-download";
import { formatBytes } from "@/lib/shared/format";
import { AppImage } from "@/components/AppImage";
import { imagePlaceholderStyle, type ResponsiveImageData } from "@/features/media/image";

type PhotoViewerProps = {
  image: ResponsiveImageData;
  alt: string;
  downloadStorageKey: string;
  downloadUrl: string;
  filename: string;
  albumSlug: string;
  prevPhotoId?: string;
  nextPhotoId?: string;
  /** Responsive data for the next photo, loaded at low priority after hydration. */
  preloadNext?: ResponsiveImageData;
  /** Extra actions rendered next to the download button */
  actions?: React.ReactNode;
};

/** Full photo viewer with keyboard navigation, swipe support, and forward prefetching. */
export function PhotoViewer({
  image,
  alt,
  downloadStorageKey,
  downloadUrl,
  filename,
  albumSlug,
  prevPhotoId,
  nextPhotoId,
  preloadNext,
  actions,
}: PhotoViewerProps) {
  const router = useRouter();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [downloadProgress, setDownloadProgress] = useState<SingleFileDownloadProgress | null>(null);
  const savingRef = useRef(false);

  /* ── Keyboard navigation ── */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && prevPhotoId) {
        void navigate({
          to: "/pics/$album/$photo",
          params: { album: albumSlug, photo: prevPhotoId },
        });
      }
      if (e.key === "ArrowRight" && nextPhotoId) {
        void navigate({
          to: "/pics/$album/$photo",
          params: { album: albumSlug, photo: nextPhotoId },
        });
      }
      if (e.key === "Escape") router.history.back();
    },
    [albumSlug, navigate, nextPhotoId, prevPhotoId, router.history],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  /* ── Show swipe hint on touch devices (first 3 visits) ── */
  useEffect(() => {
    const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (!isTouchDevice) return;

    const MAX_SHOWS = 3;
    const storedCount = Number.parseInt(getStored("swipeHintCount") || "0", 10);
    const count = Number.isFinite(storedCount) ? storedCount : 0;
    if (count >= MAX_SHOWS) return;

    setShowHint(true);
    setStored("swipeHintCount", String(count + 1));

    const timer = setTimeout(() => setShowHint(false), 2500);
    return () => clearTimeout(timer);
  }, []);

  /* ── Swipe detection via shared hook ── */
  const swipeRef = useSwipe<HTMLDivElement>({
    onSwipeLeft: nextPhotoId
      ? () =>
          void navigate({
            to: "/pics/$album/$photo",
            params: { album: albumSlug, photo: nextPhotoId },
          })
      : undefined,
    onSwipeRight: prevPhotoId
      ? () =>
          void navigate({
            to: "/pics/$album/$photo",
            params: { album: albumSlug, photo: prevPhotoId },
          })
      : undefined,
  });

  /* Prefetch one forward image after hydration when the connection allows it. */
  useEffect(() => {
    if (!preloadNext) return;
    const connection = (
      navigator as Navigator & {
        connection?: { effectiveType?: string; saveData?: boolean };
      }
    ).connection;
    if (connection?.saveData || connection?.effectiveType?.includes("2g")) return;

    const preferredSource = preloadNext.sources[0];
    const preferredFallback = preferredSource?.srcSet.split(",").at(-1)?.trim().split(/\s+/)[0];
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = preferredFallback ?? preloadNext.src;
    link.imageSrcset = preferredSource?.srcSet ?? preloadNext.srcSet;
    link.imageSizes = "(min-width: 768px) 80vw, calc(100vw - 2rem)";
    link.type = preferredSource?.type ?? "image/webp";
    link.fetchPriority = "low";
    document.head.appendChild(link);

    return () => {
      if (link.parentNode) link.parentNode.removeChild(link);
    };
  }, [preloadNext]);

  /** Request a direct download URL and hand off to the browser */
  const handleDownload = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setDownloadError("");
    setDownloadProgress(null);
    try {
      await downloadFile({
        storageKey: downloadStorageKey,
        filename,
        fallbackUrl: downloadUrl,
        onProgress: setDownloadProgress,
      });
    } catch (err) {
      console.error("Download failed:", err);
      setDownloadError("Download failed. Check your connection and try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
      setDownloadProgress(null);
    }
  }, [downloadStorageKey, downloadUrl, filename]);

  const downloadLabel =
    saving && downloadProgress
      ? downloadProgress.totalBytes
        ? `${formatBytes(downloadProgress.receivedBytes)} / ${formatBytes(downloadProgress.totalBytes)}`
        : `${formatBytes(downloadProgress.receivedBytes)}`
      : saving
        ? "saving..."
        : "download ↓";

  const isPortrait = image.height > image.width;

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Image container — swipe left/right to navigate */}
      <div
        ref={swipeRef}
        className={`relative w-full flex items-center justify-center touch-pan-y ${isPortrait ? "max-w-md" : "max-w-full"}`}
      >
        {/* Shared sizing wrapper — width uses min() to pick the smaller of
            full-width or the width derived from 80vh at the image's ratio.
            This keeps the border pixel-aligned with the image under both
            the width constraint and the height constraint. */}
        <div
          className="media-image-placeholder relative mx-auto rounded-sm overflow-hidden"
          style={{
            aspectRatio: `${image.width} / ${image.height}`,
            maxHeight: "80vh",
            width: `min(100%, calc(80vh * ${image.width} / ${image.height}))`,
            ...imagePlaceholderStyle(image.placeholder),
          }}
        >
          <AppImage
            src={image.src}
            srcSet={image.srcSet}
            sources={image.sources}
            alt={alt}
            width={image.width}
            height={image.height}
            reveal
            priority
            sizes="(min-width: 768px) 80vw, calc(100vw - 2rem)"
            className="h-full w-full rounded-sm object-contain"
          />
        </div>

        {/* Swipe hint — shown once on first visit, touch devices only */}
        {showHint && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none animate-swipe-hint">
            <span className="font-mono text-micro text-white/70 bg-black/40 backdrop-blur-sm px-4 py-2 rounded-full tracking-wide">
              ← swipe to browse →
            </span>
          </div>
        )}
      </div>

      {/* Navigation + download */}
      <div className="flex w-full max-w-md flex-wrap items-center justify-between gap-x-4 font-mono text-xs theme-muted">
        <div className="flex items-center gap-1">
          {prevPhotoId ? (
            <Link
              to="/pics/$album/$photo"
              params={{ album: albumSlug, photo: prevPhotoId }}
              className="inline-flex min-h-11 items-center px-2 hover:text-foreground transition-colors"
            >
              ← prev
            </Link>
          ) : (
            <span className="inline-flex min-h-11 items-center px-2 theme-faint">← prev</span>
          )}
          {nextPhotoId ? (
            <Link
              to="/pics/$album/$photo"
              params={{ album: albumSlug, photo: nextPhotoId }}
              className="inline-flex min-h-11 items-center px-2 hover:text-foreground transition-colors"
            >
              next →
            </Link>
          ) : (
            <span className="inline-flex min-h-11 items-center px-2 theme-faint">next →</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {actions}
          <button
            type="button"
            onClick={handleDownload}
            disabled={saving}
            className="inline-flex min-h-11 items-center px-2 hover:text-foreground transition-colors disabled:opacity-50"
          >
            {downloadLabel}
          </button>
        </div>
      </div>
      {downloadError ? (
        <p
          role="alert"
          className="w-full max-w-md font-mono text-micro text-[var(--prose-hashtag)]"
        >
          {downloadError}
        </p>
      ) : null}
    </div>
  );
}
