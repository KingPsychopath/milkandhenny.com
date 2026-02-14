"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSwipe } from "@/hooks/useSwipe";
import { fetchBlob, downloadBlob } from "@/lib/media/download";

type PhotoViewerProps = {
  src: string;
  downloadUrl: string;
  filename: string;
  width: number;
  height: number;
  prevHref?: string;
  nextHref?: string;
  /** URL of the next photo to preload (WebP full-size) */
  preloadNext?: string;
  /** URL of the previous photo to preload (WebP full-size) */
  preloadPrev?: string;
  /** Optional blur data URI for instant placeholder while full image loads */
  blur?: string;
  /** Extra actions rendered next to the download button */
  actions?: React.ReactNode;
};

/**
 * Full photo viewer with keyboard navigation, swipe support, loading state,
 * blur placeholder, and adjacent image preloading.
 */
export function PhotoViewer({
  src,
  downloadUrl,
  filename,
  width,
  height,
  prevHref,
  nextHref,
  preloadNext,
  preloadPrev,
  blur,
  actions,
}: PhotoViewerProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [showLoadingText, setShowLoadingText] = useState(false);
  const savingRef = useRef(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const skeletonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Keyboard navigation ── */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && prevHref) router.push(prevHref);
      if (e.key === "ArrowRight" && nextHref) router.push(nextHref);
      if (e.key === "Escape") router.back();
    },
    [router, prevHref, nextHref]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  /* ── Show swipe hint on touch devices (first 3 visits) ── */
  useEffect(() => {
    const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (!isTouchDevice) return;

    const HINT_KEY = "mah:swipe-hint-count";
    const MAX_SHOWS = 3;
    const count = parseInt(localStorage.getItem(HINT_KEY) || "0", 10);
    if (count >= MAX_SHOWS) return;

    setShowHint(true);
    localStorage.setItem(HINT_KEY, String(count + 1));

    const timer = setTimeout(() => setShowHint(false), 2500);
    return () => clearTimeout(timer);
  }, []);

  /* ── Swipe detection via shared hook ── */
  const swipeRef = useSwipe<HTMLDivElement>({
    onSwipeLeft: nextHref ? () => router.push(nextHref) : undefined,
    onSwipeRight: prevHref ? () => router.push(prevHref) : undefined,
  });

  /* ── Preload adjacent images (foolproof: prefetch link + Image() so cache is warm) ── */
  useEffect(() => {
    if (!preloadNext) return;

    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "image";
    link.href = preloadNext;
    document.head.appendChild(link);

    (new Image()).src = preloadNext;

    return () => {
      if (link.parentNode) link.parentNode.removeChild(link);
    };
  }, [preloadNext]);

  useEffect(() => {
    if (!preloadPrev) return;

    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "image";
    link.href = preloadPrev;
    document.head.appendChild(link);

    (new Image()).src = preloadPrev;

    return () => {
      if (link.parentNode) link.parentNode.removeChild(link);
    };
  }, [preloadPrev]);

  /** Mark the image as loaded and kill pending skeleton timers */
  const markLoaded = useCallback(() => {
    setImageLoaded(true);
    setShowSkeleton(false);
    setShowLoadingText(false);
    if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current);
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
  }, []);

  /* ── Reset loaded state when src changes ── */
  useEffect(() => {
    // If the image is already complete (cached / fast hydration), skip skeleton entirely
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      markLoaded();
      return;
    }

    setImageLoaded(false);
    setShowSkeleton(false);
    setShowLoadingText(false);

    // Staggered reveal: skeleton after 150ms, loading text after 400ms.
    // Cached/prefetched images load in <100ms so neither ever appears.
    if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current);
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    skeletonTimerRef.current = setTimeout(() => setShowSkeleton(true), 150);
    loadingTimerRef.current = setTimeout(() => setShowLoadingText(true), 400);

    return () => {
      if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current);
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    };
  }, [src, markLoaded]);

  /** Fetch blob directly from R2 and trigger download */
  const handleDownload = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const blob = await fetchBlob(downloadUrl);
      downloadBlob(blob, filename);
    } catch (err) {
      console.error("Download failed:", err);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [downloadUrl, filename]);

  const isPortrait = height > width;

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Image container — swipe left/right to navigate */}
      <div
        ref={swipeRef}
        className={`relative w-full flex items-center justify-center touch-pan-y ${
          isPortrait ? "max-w-md" : "max-w-full"
        }`}
      >
        {/* Shared sizing wrapper — width uses min() to pick the smaller of
            full-width or the width derived from 80vh at the image's ratio.
            This keeps the border pixel-aligned with the image under both
            the width constraint and the height constraint. */}
        <div
          className="relative mx-auto rounded-sm overflow-hidden"
          style={{
            aspectRatio: `${width} / ${height}`,
            maxHeight: "80vh",
            width: `min(100%, calc(80vh * ${width} / ${height}))`,
          }}
        >
          {/* Skeleton frame — delayed 150ms so cached images never flash it */}
          {!imageLoaded && showSkeleton && (
            <div
              className={`absolute inset-0 flex items-center justify-center ${
                showLoadingText ? "animate-pulse" : ""
              }`}
            >
              {blur ? (
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: `url(${blur})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    filter: "blur(20px)",
                    transform: "scale(1.1)",
                  }}
                />
              ) : (
                <div className="absolute inset-0 border theme-border rounded-sm" />
              )}

              {showLoadingText && (
                <span className="relative z-10 font-mono text-[11px] theme-muted tracking-wide">
                  loading...
                </span>
              )}
            </div>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={src}
            alt={`Full size photo — ${filename}`}
            width={width}
            height={height}
            onLoad={markLoaded}
            className={`w-full h-full object-contain rounded-sm ${
              imageLoaded ? "photo-page-fade-in" : "opacity-0"
            }`}
          />
        </div>

        {/* Swipe hint — shown once on first visit, touch devices only */}
        {showHint && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none animate-swipe-hint">
            <span className="font-mono text-[11px] text-white/70 bg-black/40 backdrop-blur-sm px-4 py-2 rounded-full tracking-wide">
              ← swipe to browse →
            </span>
          </div>
        )}
      </div>

      {/* Navigation + download */}
      <div className="flex items-center justify-between w-full max-w-md font-mono text-xs theme-muted">
        <div className="flex items-center gap-4">
          {prevHref ? (
            <Link href={prevHref} className="hover:text-foreground transition-colors">
              ← prev
            </Link>
          ) : (
            <span className="theme-faint">← prev</span>
          )}
          {nextHref ? (
            <Link href={nextHref} className="hover:text-foreground transition-colors">
              next →
            </Link>
          ) : (
            <span className="theme-faint">next →</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {actions}
          <button
            onClick={handleDownload}
            disabled={saving}
            className="hover:text-foreground transition-colors disabled:opacity-50"
          >
            {saving ? "saving..." : "download ↓"}
          </button>
        </div>
      </div>
    </div>
  );
}
