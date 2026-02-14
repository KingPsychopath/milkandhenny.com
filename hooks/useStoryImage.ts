"use client";

import { useState, useCallback, useRef } from "react";
import type { FocalPreset } from "@/lib/focal";
import { focalPresetToPercent } from "@/lib/focal";

const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;

type StoryImageConfig = {
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

type StoryImageState = {
  generating: boolean;
  blob: Blob | null;
  previewUrl: string | null;
  error: string | null;
};

/** Load an image from a URL, fetching as blob to avoid CORS canvas tainting */
async function loadImage(url: string): Promise<HTMLImageElement> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const blob = await res.blob();
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
 */
function drawOverlay(
  ctx: CanvasRenderingContext2D,
  albumTitle: string,
  photoId: string
) {
  const w = STORY_WIDTH;
  const h = STORY_HEIGHT;

  // Bottom gradient — starts at 60% height, same feel as OG (58%)
  const gradientStart = Math.round(h * 0.6);
  const gradient = ctx.createLinearGradient(0, gradientStart, 0, h);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0.75)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, gradientStart, w, h - gradientStart);

  const textY = h - 80;
  const padding = 56;

  // Brand + title (left)
  ctx.font = "600 32px 'Courier New', Courier, monospace";
  ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.lineWidth = 1.2;
  ctx.textBaseline = "bottom";
  ctx.textAlign = "start";

  const brandText = `milk & henny · ${albumTitle}`;
  ctx.strokeText(brandText, padding, textY);
  ctx.fillText(brandText, padding, textY);

  // Photo ID (right)
  ctx.font = "600 26px 'Courier New', Courier, monospace";
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.textAlign = "end";
  ctx.strokeText(photoId, w - padding, textY);
  ctx.fillText(photoId, w - padding, textY);
}

/** Generate the full story image as a JPEG blob */
async function generateStoryBlob(config: StoryImageConfig): Promise<Blob> {
  const img = await loadImage(config.imageUrl);
  const focal = getFocalPercent(config.focalPoint, config.autoFocal);

  const canvas = document.createElement("canvas");
  canvas.width = STORY_WIDTH;
  canvas.height = STORY_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  drawCoverCrop(ctx, img, STORY_WIDTH, STORY_HEIGHT, focal);
  drawOverlay(ctx, config.albumTitle, config.photoId);

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
 * Generates a branded story image (1080×1920) from the full photo
 * with the "milk & henny" overlay, entirely client-side via Canvas.
 */
export function useStoryImage() {
  const [state, setState] = useState<StoryImageState>({
    generating: false,
    blob: null,
    previewUrl: null,
    error: null,
  });
  const previewUrlRef = useRef<string | null>(null);

  const generate = useCallback(async (config: StoryImageConfig) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }

    setState({ generating: true, blob: null, previewUrl: null, error: null });

    try {
      const blob = await generateStoryBlob(config);
      const previewUrl = URL.createObjectURL(blob);
      previewUrlRef.current = previewUrl;
      setState({ generating: false, blob, previewUrl, error: null });
      return blob;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to generate story image";
      setState({ generating: false, blob: null, previewUrl: null, error: message });
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
