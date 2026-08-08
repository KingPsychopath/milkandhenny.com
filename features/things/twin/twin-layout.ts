import { twinRandom } from "./twin-deck";

/**
 * Where the symbols sit on a card.
 *
 * A card is not a list. The same symbols in the same places would be memorised in three heats, so
 * every dealt card carries a seed and its layout is derived from it: position, rotation anywhere in
 * 360°, and a size somewhere in a range. The variation *is* the difficulty.
 *
 * Derived rather than stored because the same card has to look identical on every device that sees it
 * in a heat — otherwise one player is hunting an easier arrangement than another, and a presenter
 * screen could never agree with a phone. A seed in room state plus a pure function gets that for
 * free, and makes the whole thing testable without a browser.
 */

export interface TwinPlacement {
  symbolId: string;
  /** Centre, as a fraction of the card face. */
  x: number;
  y: number;
  /** Width and height, as a fraction of the card face. */
  size: number;
  /** Degrees. */
  rotation: number;
}

export interface TwinLayoutOptions {
  /** Padding from the card edge, as a fraction of the face. */
  padding?: number;
  /** Smallest and largest symbol size relative to the packing radius. Widen it to make cards harder. */
  scale?: [number, number];
}

const DEFAULTS = { padding: 0.06, scale: [0.62, 1] as [number, number] };

/**
 * Dart throwing with a shrinking radius.
 *
 * Symbols are placed at random and rejected when they collide with one already down. After enough
 * consecutive rejections the radius shrinks and it tries again, which is what guarantees the loop
 * ends: a small enough radius always fits. Simple, seedable, and it produces the scattered look the
 * game wants rather than the readable grid a packing algorithm would.
 */
export function twinLayout(
  symbolIds: readonly string[],
  seed: number,
  options: TwinLayoutOptions = {},
): TwinPlacement[] {
  const padding = options.padding ?? DEFAULTS.padding;
  const [minScale, maxScale] = options.scale ?? DEFAULTS.scale;
  const random = twinRandom(seed);
  const count = symbolIds.length;

  // Starting radius assumes the symbols tile the face loosely; the loop takes it down from there.
  let radius = Math.min(0.22, 0.62 / Math.sqrt(count));

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const placed: TwinPlacement[] = [];
    let rejections = 0;

    while (placed.length < count && rejections < 400) {
      const scale = minScale + (maxScale - minScale) * random();
      const size = radius * 2 * scale;
      const half = size / 2;
      const span = 1 - 2 * (padding + half);
      if (span <= 0) break;
      const x = padding + half + random() * span;
      const y = padding + half + random() * span;
      const clash = placed.some((other) => {
        const distance = Math.hypot(other.x - x, other.y - y);
        // 0.94 lets the bounding boxes kiss: these are line drawings, not solid discs, and a hair of
        // overlap reads as a scattered pile rather than a diagram.
        return distance < ((other.size + size) / 2) * 0.94;
      });
      if (clash) {
        rejections += 1;
        continue;
      }
      rejections = 0;
      placed.push({ symbolId: symbolIds[placed.length], x, y, size, rotation: random() * 360 });
    }

    if (placed.length === count) return placed;
    radius *= 0.92;
  }

  // Unreachable in practice — 40 shrinks takes the radius to a twentieth of where it started.
  throw new Error(`Could not lay out ${count} symbols`);
}

/** Bounding box of a placement, for hit testing and for the ray's endpoints. */
export function twinPlacementBounds(placement: TwinPlacement) {
  const half = placement.size / 2;
  return {
    left: placement.x - half,
    top: placement.y - half,
    right: placement.x + half,
    bottom: placement.y + half,
  };
}
