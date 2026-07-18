import type { CountryDrawing, DrawPoint } from "./types";

export const DRAWING_WIDTH = 1_000;
export const DRAWING_HEIGHT = 750;
export const MAX_DRAWING_RINGS = 20;
export const MAX_POINTS_PER_RING = 500;
export const MAX_DRAWING_POINTS = 850;

export function parseCountryDrawing(value: unknown): CountryDrawing {
  if (!Array.isArray(value) || value.length > MAX_DRAWING_RINGS) throw new Error("Invalid drawing");
  let total = 0;
  return value.map((candidate) => {
    if (!Array.isArray(candidate) || candidate.length > MAX_POINTS_PER_RING)
      throw new Error("Invalid drawing");
    total += candidate.length;
    if (total > MAX_DRAWING_POINTS) throw new Error("Drawing is too detailed");
    return candidate.map((raw): DrawPoint => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid point");
      const point = Object.fromEntries(Object.entries(raw));
      if (
        typeof point.x !== "number" ||
        typeof point.y !== "number" ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.x > DRAWING_WIDTH ||
        point.y < 0 ||
        point.y > DRAWING_HEIGHT
      )
        throw new Error("Invalid point");
      return { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 };
    });
  });
}
