"use client";

import { useEffect, useCallback, useState } from "react";
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

  /** Fetch blob directly from R2 and trigger download */
  const handleDownload = useCallback(async () => {
    if (saving) return;
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
      setSaving(false);
    }
  }, [downloadUrl, filename, saving]);

  const isPortrait = height > width;

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Image container */}
      <div
        className={`relative w-full flex items-center justify-center ${
          isPortrait ? "max-w-md" : "max-w-full"
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          width={width}
          height={height}
          className="w-full h-auto rounded-sm"
          style={{ maxHeight: "80vh", objectFit: "contain" }}
        />
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
