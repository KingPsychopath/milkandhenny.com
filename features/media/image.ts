import type { CSSProperties } from "react";

const RESPONSIVE_IMAGE_WIDTHS = [480, 960, 1600] as const;
const RESPONSIVE_IMAGE_FORMATS = ["avif", "webp"] as const;

type ResponsiveImageFormat = (typeof RESPONSIVE_IMAGE_FORMATS)[number];

interface ImagePlaceholder {
  color: string;
  blurDataUrl?: string;
}

interface ResponsiveImageMetadata {
  width: number;
  height: number;
  version: string;
  widths: number[];
  placeholder: ImagePlaceholder;
}

interface ResponsiveImageSource {
  type: `image/${ResponsiveImageFormat}`;
  srcSet: string;
}

interface ResponsiveImageData extends ResponsiveImageMetadata {
  src: string;
  srcSet: string;
  sources: ResponsiveImageSource[];
}

function imagePlaceholderStyle(
  placeholder: ImagePlaceholder | undefined,
  mode: "blur" | "color" = "blur",
): CSSProperties | undefined {
  if (!placeholder) return undefined;
  return {
    backgroundColor: placeholder.color,
    ...(mode === "blur" && placeholder.blurDataUrl
      ? {
          backgroundImage: `url(${placeholder.blurDataUrl})`,
          backgroundPosition: "center",
          backgroundSize: "cover",
        }
      : {}),
  };
}

function normaliseResponsiveWidths(widths: readonly number[], sourceWidth: number): number[] {
  const candidates = widths
    .map((width) => Math.round(width))
    .filter((width) => Number.isFinite(width) && width > 0 && width < sourceWidth);
  candidates.push(Math.round(sourceWidth));
  return [...new Set(candidates)].sort((a, b) => a - b);
}

export {
  RESPONSIVE_IMAGE_FORMATS,
  RESPONSIVE_IMAGE_WIDTHS,
  imagePlaceholderStyle,
  normaliseResponsiveWidths,
};

export type {
  ImagePlaceholder,
  ResponsiveImageData,
  ResponsiveImageFormat,
  ResponsiveImageMetadata,
  ResponsiveImageSource,
};
