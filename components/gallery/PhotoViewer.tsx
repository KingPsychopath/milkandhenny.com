"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type PhotoViewerProps = {
  src: string;
  downloadUrl: string;
  filename: string;
  width: number;
  height: number;
  prevHref?: string;
  nextHref?: string;
};

/**
 * Full photo viewer with keyboard navigation and download.
 * Arrow keys navigate between photos. Escape goes back to album.
 */
export function PhotoViewer({
  src,
  downloadUrl,
  filename,
  width,
  height,
  prevHref,
  nextHref,
}: PhotoViewerProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const savingRef = useRef(false);
  const touchRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);

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

  /* ── Swipe detection on image area ── */
  useEffect(() => {
    const el = imageContainerRef.current;
    if (!el) return;

    const SWIPE_MIN_DISTANCE = 50; // px
    const SWIPE_MAX_TIME = 300; // ms
    const SWIPE_MAX_VERTICAL = 80; // px — ignore diagonal/vertical swipes

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      touchRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!touchRef.current) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchRef.current.x;
      const dy = touch.clientY - touchRef.current.y;
      const dt = Date.now() - touchRef.current.time;
      touchRef.current = null;

      // Must be fast, horizontal, and long enough
      if (dt > SWIPE_MAX_TIME || Math.abs(dy) > SWIPE_MAX_VERTICAL || Math.abs(dx) < SWIPE_MIN_DISTANCE) return;

      if (dx < 0 && nextHref) router.push(nextHref); // swipe left → next
      if (dx > 0 && prevHref) router.push(prevHref); // swipe right → prev
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [router, prevHref, nextHref]);

  /** Fetch blob directly from R2 and trigger download */
  const handleDownload = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const res = await fetch(downloadUrl, { mode: "cors" });
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(href);
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
        ref={imageContainerRef}
        className={`relative w-full flex items-center justify-center touch-pan-y ${
          isPortrait ? "max-w-md" : "max-w-full"
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={`Full size photo — ${filename}`}
          width={width}
          height={height}
          className="w-full h-auto rounded-sm photo-page-fade-in"
          style={{ maxHeight: "80vh", objectFit: "contain" }}
        />

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
        <button
          onClick={handleDownload}
          disabled={saving}
          className="hover:text-foreground transition-colors disabled:opacity-50"
        >
          {saving ? "saving..." : "download ↓"}
        </button>
      </div>
    </div>
  );
}
