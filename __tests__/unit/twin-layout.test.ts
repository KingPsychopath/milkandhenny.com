import { describe, expect, it } from "vitest";

import { twinDeck } from "../../features/things/twin/twin-deck";
import { twinLayout, twinPlacementBounds } from "../../features/things/twin/twin-layout";

const CARD = twinDeck(5)[0];

describe("card layout", () => {
  it("places every symbol on the card, once, in order", () => {
    const placements = twinLayout(CARD.symbolIds, 7);
    expect(placements.map(({ symbolId }) => symbolId)).toEqual(CARD.symbolIds);
  });

  it("is identical for the same seed", () => {
    expect(twinLayout(CARD.symbolIds, 99)).toEqual(twinLayout(CARD.symbolIds, 99));
  });

  it("differs between seeds", () => {
    expect(twinLayout(CARD.symbolIds, 1)).not.toEqual(twinLayout(CARD.symbolIds, 2));
  });

  /**
   * The two rules a card face has to keep no matter what the seed is. A symbol off the edge is
   * unfindable, and two symbols on top of each other make the match ambiguous to the eye.
   */
  it("keeps every symbol inside the card, at every deck size, for many seeds", () => {
    for (const order of [4, 5]) {
      for (const card of twinDeck(order)) {
        for (let seed = 0; seed < 12; seed += 1) {
          for (const placement of twinLayout(card.symbolIds, seed)) {
            const bounds = twinPlacementBounds(placement);
            expect(bounds.left).toBeGreaterThanOrEqual(0);
            expect(bounds.top).toBeGreaterThanOrEqual(0);
            expect(bounds.right).toBeLessThanOrEqual(1);
            expect(bounds.bottom).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it("never stacks two symbols on top of each other", () => {
    for (const order of [4, 5])
      for (const card of twinDeck(order))
        for (let seed = 0; seed < 12; seed += 1) {
          const placements = twinLayout(card.symbolIds, seed);
          for (let i = 0; i < placements.length; i += 1)
            for (let j = i + 1; j < placements.length; j += 1) {
              const distance = Math.hypot(
                placements[i].x - placements[j].x,
                placements[i].y - placements[j].y,
              );
              const touching = ((placements[i].size + placements[j].size) / 2) * 0.94;
              expect(distance).toBeGreaterThanOrEqual(touching);
            }
        }
  });

  it("varies rotation and size, which is where the difficulty comes from", () => {
    const placements = twinLayout(CARD.symbolIds, 5);
    const rotations = placements.map(({ rotation }) => rotation);
    const sizes = placements.map(({ size }) => size);
    for (const rotation of rotations) {
      expect(rotation).toBeGreaterThanOrEqual(0);
      expect(rotation).toBeLessThan(360);
    }
    expect(new Set(rotations).size).toBeGreaterThan(1);
    expect(Math.max(...sizes)).toBeGreaterThan(Math.min(...sizes));
  });

  it("still fits a card twice as crowded as any in play", () => {
    const crowded = Array.from({ length: 16 }, (_unused, index) => `s${index}`);
    expect(twinLayout(crowded, 3)).toHaveLength(16);
  });
});
