/**
 * Focal point presets for image cropping.
 * Client-safe — no Node imports. Used by AlbumEmbed, lib/albums, scripts.
 *
 * Every preset maps to an { x, y } percentage (0–100) which drives both
 * CSS object-position and Sharp percentage-based cropping.
 */

export const FOCAL_PRESETS = [
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "top left",
  "top right",
  "bottom left",
  "bottom right",
  "mid top",
  "mid bottom",
  "mid left",
  "mid right",
] as const;

export type FocalPreset = (typeof FOCAL_PRESETS)[number];

/** Shorthand → full preset (CLI convenience) */
export const FOCAL_SHORTHAND: Record<string, FocalPreset> = {
  c: "center",
  t: "top",
  b: "bottom",
  l: "left",
  r: "right",
  tl: "top left",
  tr: "top right",
  bl: "bottom left",
  br: "bottom right",
  mt: "mid top",
  mb: "mid bottom",
  ml: "mid left",
  mr: "mid right",
};

/** Percentage-based focal point. x = horizontal (0 left, 100 right), y = vertical (0 top, 100 bottom). */
const FOCAL_PERCENT: Record<FocalPreset, { x: number; y: number }> = {
  center: { x: 50, y: 50 },
  top: { x: 50, y: 0 },
  bottom: { x: 50, y: 100 },
  left: { x: 0, y: 50 },
  right: { x: 100, y: 50 },
  "top left": { x: 0, y: 0 },
  "top right": { x: 100, y: 0 },
  "bottom left": { x: 0, y: 100 },
  "bottom right": { x: 100, y: 100 },
  "mid top": { x: 50, y: 25 },
  "mid bottom": { x: 50, y: 75 },
  "mid left": { x: 25, y: 50 },
  "mid right": { x: 75, y: 50 },
};

/** Get the percentage-based focal point for a preset */
export function focalPresetToPercent(preset: FocalPreset): { x: number; y: number } {
  return FOCAL_PERCENT[preset];
}

/** Expand shorthand or validate full preset. Returns null if invalid. */
export function resolveFocalPreset(value: string): FocalPreset | null {
  const lower = value.toLowerCase().trim();
  const expanded = FOCAL_SHORTHAND[lower] ?? lower;
  return FOCAL_PRESETS.includes(expanded as FocalPreset)
    ? (expanded as FocalPreset)
    : null;
}

/** Type guard for preset strings from JSON */
export function isValidFocalPreset(s: string): s is FocalPreset {
  return (FOCAL_PRESETS as readonly string[]).includes(s);
}

/** Convert focal preset to CSS object-position value */
export function focalPresetToObjectPosition(preset: FocalPreset): string {
  const { x, y } = FOCAL_PERCENT[preset];
  return `${x}% ${y}%`;
}
