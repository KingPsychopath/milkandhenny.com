"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useBrandedImage, type BrandedFormat } from "../_hooks/useBrandedImage";
import { useOutsideClick } from "@/hooks/useOutsideClick";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import type { FocalPreset } from "@/features/media/focal";

type BrandedImageProps = {
  /** Full-size image URL (WebP from R2) */
  imageUrl: string;
  /** Album title for overlay text */
  albumTitle: string;
  /** Photo ID for overlay text */
  photoId: string;
  /** Manual focal point preset */
  focalPoint?: FocalPreset;
  /** Auto-detected focal point as percentages */
  autoFocal?: { x: number; y: number };
};

const COPIED_DURATION_MS = 2000;

function canUseNativeShareOnMobile(): boolean {
  if (typeof window === "undefined") return false;
  return typeof navigator.share === "function" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Copy a blob as an image to the clipboard (re-encodes as PNG for compat) */
async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  try {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(bmp, 0, 0);
    const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!pngBlob) return false;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
    return true;
  } catch {
    return false;
  }
}

/** Try native share with an image file. Returns true if shared successfully. */
async function tryNativeShare(blob: Blob, filename: string, title: string): Promise<boolean> {
  if (typeof navigator.share !== "function") return false;
  try {
    const file = new File([blob], filename, { type: "image/jpeg" });
    if (!navigator.canShare?.({ files: [file] })) return false;
    await navigator.share({ files: [file], title });
    return true;
  } catch {
    // User cancelled — not an error
    return false;
  }
}

const FORMAT_OPTIONS = [
  { key: "portrait" as BrandedFormat, label: "story · portrait", desc: "9:16" },
  {
    key: "landscape" as BrandedFormat,
    label: "post · landscape",
    desc: "16:9",
  },
] as const;

/**
 * "Frame" button — sits next to download in the photo viewer.
 * Lets user pick portrait (story) or landscape (post), generates a
 * branded image with the overlay client-side, then shows a frame preview.
 *
 * Frame preview actions:
 * - Mobile: "share" (native share sheet) + "download" + "close"
 * - Desktop: "copy image" + "download" + "close"
 */
export function BrandedImage({ imageUrl, albumTitle, photoId, focalPoint, autoFocal }: BrandedImageProps) {
  const { generating, error, blob, previewUrl, generate, cleanup } = useBrandedImage();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isMobile] = useState<boolean>(() => canUseNativeShareOnMobile());
  const [activeFormat, setActiveFormat] = useState<BrandedFormat>("portrait");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_DURATION_MS);
    return () => clearTimeout(t);
  }, [copied]);

  useOutsideClick(dropdownRef, () => setDropdownOpen(false), dropdownOpen);

  const handleFormatPick = useCallback(
    async (format: BrandedFormat) => {
      setDropdownOpen(false);
      setActiveFormat(format);

      await generate({
        imageUrl,
        albumTitle,
        photoId,
        format,
        focalPoint,
        autoFocal,
      });

      // Always show frame preview so user sees the result before acting
      setShowPreview(true);
    },
    [generate, imageUrl, albumTitle, photoId, focalPoint, autoFocal]
  );

  const handleShare = useCallback(async () => {
    if (!blob) return;
    const shared = await tryNativeShare(blob, `${photoId}-${activeFormat}.jpg`, `${albumTitle} — ${photoId}`);
    if (shared) {
      setShowPreview(false);
      cleanup();
    }
  }, [blob, photoId, activeFormat, albumTitle, cleanup]);

  const handleDownload = useCallback(() => {
    if (!blob) return;
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `${photoId}-${activeFormat}.jpg`;
    a.click();
    URL.revokeObjectURL(href);
  }, [blob, photoId, activeFormat]);

  const handleCopy = useCallback(async () => {
    if (!blob) return;
    const ok = await copyImageToClipboard(blob);
    if (ok) setCopied(true);
  }, [blob]);

  const handleClose = useCallback(() => {
    setShowPreview(false);
    setCopied(false);
    cleanup();
  }, [cleanup]);

  useEscapeKey(handleClose, showPreview);

  return (
    <>
      {/* Trigger — dropdown for format selection */}
      <div ref={dropdownRef} className="relative inline-block">
        <button
          type="button"
          onClick={() => setDropdownOpen((o) => !o)}
          disabled={generating}
          aria-expanded={dropdownOpen}
          aria-haspopup="true"
          className="inline-flex items-center gap-0.5 hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded disabled:opacity-50"
        >
          {generating ? "framing..." : "frame"}
          <svg
            className={`w-3 h-3 ml-0.5 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {dropdownOpen && (
          <div
            className="absolute right-0 bottom-full mb-1 py-1.5 min-w-[11rem] bg-background border theme-border rounded-sm shadow-lg z-10"
            role="menu"
          >
            {FORMAT_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                role="menuitem"
                onClick={() => handleFormatPick(opt.key)}
                className="block w-full text-left px-3 py-1.5 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors font-mono text-micro tracking-wide"
              >
                <span className="theme-muted">{opt.label}</span>
                <span className="ml-2 theme-faint">{opt.desc}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Frame preview — always shown after generation */}
      {showPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={handleClose}
          role="dialog"
          aria-modal="true"
          aria-label="Frame preview"
        >
          <div className="relative flex flex-col items-center gap-4 p-4" onClick={(e) => e.stopPropagation()}>
            {/* Error state */}
            {error && (
              <div className="max-w-xs text-center">
                <p className="font-mono text-micro text-red-400 tracking-wide">{error}</p>
                <button
                  onClick={handleClose}
                  className="mt-4 font-mono text-micro text-white/50 hover:text-white transition-colors tracking-wide"
                >
                  close
                </button>
              </div>
            )}

            {/* Preview image */}
            {previewUrl && (
              <>
                <div
                  className={`relative rounded-sm overflow-hidden shadow-2xl ${
                    activeFormat === "portrait" ? "max-h-[75vh] aspect-[9/16]" : "max-w-[90vw] sm:max-w-2xl aspect-[1.91/1]"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="Framed image with milk & henny overlay" className="h-full w-full object-contain" />
                </div>

                {/* Frame preview actions
                    Mobile: share (native sheet) + download + close
                    Desktop: copy image + download + close */}
                <div className="flex items-center gap-6 font-mono text-micro tracking-wide">
                  {isMobile ? (
                    <button onClick={handleShare} className="text-white hover:text-amber-400 transition-colors">
                      share
                    </button>
                  ) : (
                    <button onClick={handleCopy} className="text-white hover:text-amber-400 transition-colors">
                      {copied ? "copied" : "copy image"}
                    </button>
                  )}
                  <button onClick={handleDownload} className="text-white hover:text-amber-400 transition-colors">
                    download ↓
                  </button>
                  <button onClick={handleClose} className="text-white/50 hover:text-white transition-colors">
                    close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

