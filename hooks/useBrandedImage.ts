"use client";

import { useState, useCallback, useRef } from "react";
import type { FocalPreset } from "@/lib/focal";
import { focalPresetToPercent } from "@/lib/focal";

/** Supported branded image formats */
const FORMATS = {
  /** Instagram / TikTok stories */
  portrait: { width: 1080, height: 1920 },
  /** Twitter / Facebook / LinkedIn posts (matches OG dimensions) */
  landscape: { width: 1200, height: 630 },
} as const;

type BrandedFormat = keyof typeof FORMATS;

type BrandedImageConfig = {
  /** Full-size image URL (WebP from R2) */
  imageUrl: string;
  /** Album title for overlay text */
  albumTitle: string;
  /** Photo ID for overlay text */
  photoId: string;
  /** Output format */
  format: BrandedFormat;
  /** Manual focal point preset */
  focalPoint?: FocalPreset;
  /** Auto-detected focal point as percentages */
  autoFocal?: { x: number; y: number };
};

type BrandedImageState = {
  generating: boolean;
  blob: Blob | null;
  previewUrl: string | null;
  error: string | null;
};

/**
 * Convert an R2 URL to a same-origin proxy path.
 * Fallback for when R2 doesn't return CORS headers (e.g. localhost).
 */
function toProxyUrl(url: string): string {
  const r2Base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "";
  if (r2Base && url.startsWith(r2Base)) {
    return "/_img" + url.slice(r2Base.length);
  }
  return url;
}

/** Fetch image as blob, trying direct first then falling back to proxy */
async function fetchImageBlob(url: string): Promise<Blob> {
  // Try direct fetch first — works when R2 has CORS configured (production).
  // Goes straight R2 → browser, no Vercel bandwidth used.
  try {
    const res = await fetch(url, { mode: "cors" });
    if (res.ok) return res.blob();
  } catch {
    // CORS blocked — fall through to proxy
  }

  // Fallback: same-origin proxy via Next.js rewrite (/_img/...).
  // Routes through Vercel edge, uses bandwidth, but always works.
  const proxyUrl = toProxyUrl(url);
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  return res.blob();
}

/** Load an image for canvas drawing, with direct → proxy fallback */
async function loadImage(url: string): Promise<HTMLImageElement> {
  const blob = await fetchImageBlob(url);
  const objectUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image"));
    };
    img.src = objectUrl;
  });
}

/** Resolve focal point to percentages, defaulting to center */
function getFocalPercent(
  focalPoint?: FocalPreset,
  autoFocal?: { x: number; y: number }
): { x: number; y: number } {
  if (focalPoint) return focalPresetToPercent(focalPoint);
  if (autoFocal) return autoFocal;
  return { x: 50, y: 50 };
}

/** Draw the image cover-cropped onto the canvas, positioned by focal point */
function drawCoverCrop(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  canvasW: number,
  canvasH: number,
  focal: { x: number; y: number }
) {
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;

  const scale = Math.max(canvasW / srcW, canvasH / srcH);
  const scaledW = srcW * scale;
  const scaledH = srcH * scale;

  const maxOffsetX = scaledW - canvasW;
  const maxOffsetY = scaledH - canvasH;
  const offsetX = -Math.round(maxOffsetX * (focal.x / 100));
  const offsetY = -Math.round(maxOffsetY * (focal.y / 100));

  ctx.drawImage(img, offsetX, offsetY, scaledW, scaledH);
}

/**
 * Draw the branded overlay matching the OG image style.
 * Bottom gradient + "milk & henny · {title}" left, photoId right.
 * Scales text and padding proportionally to canvas size.
 */
function drawOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  albumTitle: string,
  photoId: string
) {
  // Bottom gradient — covers the lower ~40% of the image
  const gradientStart = Math.round(h * 0.58);
  const gradient = ctx.createLinearGradient(0, gradientStart, 0, h);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0.72)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, gradientStart, w, h - gradientStart);

  // Scale text relative to width (base: 1200px)
  const scale = w / 1200;
  const brandSize = Math.round(28 * scale);
  const idSize = Math.round(22 * scale);
  const padding = Math.round(48 * scale);
  const textY = h - Math.round(44 * scale);

  // Brand + title (left)
  ctx.font = `600 ${brandSize}px 'Courier New', Courier, monospace`;
  ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.lineWidth = 1;
  ctx.textBaseline = "bottom";
  ctx.textAlign = "start";

  const brandText = `milk & henny · ${albumTitle}`;
  ctx.strokeText(brandText, padding, textY);
  ctx.fillText(brandText, padding, textY);

  // Photo ID (right)
  ctx.font = `600 ${idSize}px 'Courier New', Courier, monospace`;
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.textAlign = "end";
  ctx.strokeText(photoId, w - padding, textY);
  ctx.fillText(photoId, w - padding, textY);
}

/** Generate a branded image blob at the specified format */
async function generateBrandedBlob(config: BrandedImageConfig): Promise<Blob> {
  const { width, height } = FORMATS[config.format];
  const img = await loadImage(config.imageUrl);
  const focal = getFocalPercent(config.focalPoint, config.autoFocal);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  drawCoverCrop(ctx, img, width, height, focal);
  drawOverlay(ctx, width, height, config.albumTitle, config.photoId);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to generate image"));
      },
      "image/jpeg",
      0.92
    );
  });
}

/**
 * Generates a branded image from the full photo with the "milk & henny"
 * overlay, entirely client-side via Canvas. Supports portrait (story)
 * and landscape (post) formats.
 */
export function useBrandedImage() {
  const [state, setState] = useState<BrandedImageState>({
    generating: false,
    blob: null,
    previewUrl: null,
    error: null,
  });
  const previewUrlRef = useRef<string | null>(null);

  const generate = useCallback(async (config: BrandedImageConfig) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }

    setState({ generating: true, blob: null, previewUrl: null, error: null });

    try {
      const blob = await generateBrandedBlob(config);
      const previewUrl = URL.createObjectURL(blob);
      previewUrlRef.current = previewUrl;
      setState({ generating: false, blob, previewUrl, error: null });
      return blob;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to generate image";
      setState({
        generating: false,
        blob: null,
        previewUrl: null,
        error: message,
      });
      return null;
    }
  }, []);

  const cleanup = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setState({ generating: false, blob: null, previewUrl: null, error: null });
  }, []);

  return { ...state, generate, cleanup };
}

export { FORMATS };
export type { BrandedFormat, BrandedImageConfig };
