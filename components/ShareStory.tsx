"use client";

import { useState, useEffect, useCallback } from "react";
import { useStoryImage } from "@/hooks/useStoryImage";
import type { FocalPreset } from "@/lib/focal";

type ShareStoryProps = {
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
  /** Extra class for the wrapper */
  className?: string;
};

const COPIED_DURATION_MS = 2000;

/** Copy a blob as an image to the clipboard */
async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  try {
    // ClipboardItem requires image/png for clipboard write
    if (blob.type !== "image/png") {
      // Re-encode as PNG via canvas for clipboard compat
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      ctx.drawImage(bmp, 0, 0);
      const pngBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (!pngBlob) return false;
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": pngBlob }),
      ]);
    } else {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * "Share Story" button.
 * - Mobile: generates a branded 1080x1920 story image, opens native share sheet
 *   so users can pick Instagram / WhatsApp / Save to Photos / etc.
 * - Desktop: generates the image and shows a preview overlay with download + copy.
 */
export function ShareStory({
  imageUrl,
  albumTitle,
  photoId,
  focalPoint,
  autoFocal,
  className = "",
}: ShareStoryProps) {
  const { generating, error, blob, previewUrl, generate, cleanup } =
    useStoryImage();
  const [showPreview, setShowPreview] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setIsMobile(
      typeof navigator.share === "function" &&
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    );
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_DURATION_MS);
    return () => clearTimeout(t);
  }, [copied]);

  const handleClick = useCallback(async () => {
    const result = await generate({
      imageUrl,
      albumTitle,
      photoId,
      focalPoint,
      autoFocal,
    });

    if (!result) {
      // Generation failed — show preview anyway so the error is visible
      setShowPreview(true);
      return;
    }

    // Mobile: try native share with the image file
    if (isMobile && typeof navigator.share === "function") {
      try {
        const file = new File([result], `${photoId}-story.jpg`, {
          type: "image/jpeg",
        });

        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: `${albumTitle} — ${photoId}`,
          });
          cleanup();
          return;
        }
      } catch {
        // User cancelled or share failed — fall through to preview
      }
    }

    // Desktop or share not supported — show preview with download
    setShowPreview(true);
  }, [
    generate,
    isMobile,
    imageUrl,
    albumTitle,
    photoId,
    focalPoint,
    autoFocal,
    cleanup,
  ]);

  const handleDownload = useCallback(() => {
    if (!blob) return;
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `${photoId}-story.jpg`;
    a.click();
    URL.revokeObjectURL(href);
  }, [blob, photoId]);

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

  // Close preview on Escape
  useEffect(() => {
    if (!showPreview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showPreview, handleClose]);

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={generating}
        className={`inline-flex items-center gap-0.5 font-mono text-[11px] theme-muted tracking-wide hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded px-1 -mx-1 disabled:opacity-50 ${className}`}
      >
        {generating ? "creating..." : "story"}
      </button>

      {/* Preview overlay — desktop or when native share isn't available */}
      {showPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={handleClose}
          role="dialog"
          aria-modal="true"
          aria-label="Story image preview"
        >
          <div
            className="relative flex flex-col items-center gap-4 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Error state */}
            {error && (
              <div className="max-w-xs text-center">
                <p className="font-mono text-[11px] text-red-400 tracking-wide">
                  {error}
                </p>
                <button
                  onClick={handleClose}
                  className="mt-4 font-mono text-[11px] text-white/50 hover:text-white transition-colors tracking-wide"
                >
                  close
                </button>
              </div>
            )}

            {/* Story preview */}
            {previewUrl && (
              <>
                <div className="relative max-h-[75vh] aspect-[9/16] rounded-sm overflow-hidden shadow-2xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt="Story preview with milk & henny branding"
                    className="h-full w-full object-contain"
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-6 font-mono text-[11px] tracking-wide">
                  <button
                    onClick={handleCopy}
                    className="text-white hover:text-amber-400 transition-colors"
                  >
                    {copied ? "copied" : "copy image"}
                  </button>
                  <button
                    onClick={handleDownload}
                    className="text-white hover:text-amber-400 transition-colors"
                  >
                    download ↓
                  </button>
                  <button
                    onClick={handleClose}
                    className="text-white/50 hover:text-white transition-colors"
                  >
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
