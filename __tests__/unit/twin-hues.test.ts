import { describe, expect, it } from "vitest";

import {
  TWIN_HUE_COUNT,
  twinHueQuality,
  twinSymbolHue,
} from "../../features/things/twin/twin-hues";
import { twinAvailableOrders, twinDeck } from "../../features/things/twin/twin-deck";
import { TWIN_SYMBOLS } from "../../features/things/twin/twin-symbols";

describe("symbol colours", () => {
  it("gives every symbol a hue in range", () => {
    for (const symbol of TWIN_SYMBOLS) {
      const hue = twinSymbolHue(symbol.id);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(TWIN_HUE_COUNT);
    }
  });

  it("is stable across calls", () => {
    const first = TWIN_SYMBOLS.map(({ id }) => twinSymbolHue(id));
    const second = TWIN_SYMBOLS.map(({ id }) => twinSymbolHue(id));
    expect(first).toEqual(second);
  });

  it("uses the whole palette", () => {
    expect(new Set(TWIN_SYMBOLS.map(({ id }) => twinSymbolHue(id))).size).toBe(TWIN_HUE_COUNT);
  });

  /**
   * The guarantee. Three same-coloured symbols on one card is the case that actively misleads — the eye
   * pairs by colour, and a triple makes that pairing ambiguous rather than merely unhelpful.
   */
  it("never puts three symbols of one colour on a card, in any deck", () => {
    const offenders: string[] = [];
    for (const order of twinAvailableOrders())
      for (const card of twinDeck(order)) {
        const counts = new Map<number, number>();
        for (const id of card.symbolIds) {
          const hue = twinSymbolHue(id);
          counts.set(hue, (counts.get(hue) ?? 0) + 1);
        }
        for (const [hue, count] of counts)
          if (count >= 3) offenders.push(`${card.id} shows ${count} of hue ${hue}`);
      }
    expect(offenders).toEqual([]);
  });

  /**
   * Rainbow cards are impossible — any two symbols share exactly one card, so any two symbols given the
   * same colour spoil exactly one card. This pins how close the solver actually got, so a future change
   * to the palette or the symbol list cannot quietly make the cards worse.
   */
  it("keeps repeated colours as rare as the geometry allows", () => {
    const quality = twinHueQuality();
    expect(quality.worstOnACard).toBeLessThanOrEqual(2);
    expect(quality.cards).toBeGreaterThan(0);
    // Most cards should carry at most a single repeated pair.
    expect(quality.repeatedPairs / quality.cards).toBeLessThanOrEqual(1.35);
  });
});
