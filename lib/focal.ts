/**
 * Focal point presets for image cropping.
 * Client-safe — no Node imports. Used by AlbumEmbed, lib/albums, scripts.
 */

export const FOCAL_PRESETS = [
  "center",
  "top",
  "bottom",
  "top left",
  "top right",
  "bottom left",
  "bottom right",
] as const;

export type FocalPreset = (typeof FOCAL_PRESETS)[number];

/** Shorthand → full preset (CLI convenience) */
export const FOCAL_SHORTHAND: Record<string, FocalPreset> = {
  c: "center",
  t: "top",
  b: "bottom",
  tl: "top left",
  tr: "top right",
  bl: "bottom left",
  br: "bottom right",
};

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
  const map: Record<FocalPreset, string> = {
    center: "center",
    top: "top",
    bottom: "bottom",
    "top left": "left top",
    "top right": "right top",
    "bottom left": "left bottom",
    "bottom right": "right bottom",
  };
  return map[preset];
}

/** Convert focal preset to Sharp position (Sharp uses "left top" not "top left") */
export function focalPresetToSharpPosition(preset: FocalPreset): string {
  const map: Record<FocalPreset, string> = {
    center: "centre",
    top: "top",
    bottom: "bottom",
    "top left": "left top",
    "top right": "right top",
    "bottom left": "left bottom",
    "bottom right": "right bottom",
  };
  return map[preset];
}
