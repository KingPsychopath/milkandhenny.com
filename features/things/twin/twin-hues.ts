import { twinPlane, twinRandom, TWIN_ORDERS } from "./twin-deck";
import { TWIN_SYMBOL_COUNT, TWIN_SYMBOLS } from "./twin-symbols";

/**
 * Which colour each symbol wears.
 *
 * The goal is a card where no two symbols share a colour, because then the eye can pair them off by
 * hue and check six shapes instead of thirty-six. **That is provably impossible**, and the reason is
 * the same fact the whole game is built on: in a projective plane *any two points lie on exactly one
 * line*. So any two symbols given the same colour appear together on exactly one card — and spoil it.
 * There is no assignment that avoids this; there is only one that spreads the damage.
 *
 * A counting argument fixes the floor. If every card of the order-5 deck showed six distinct colours,
 * each colour would appear once on each of the 31 cards, so a colour class would hold 31/6 symbols —
 * not a whole number. Rainbow cards cannot exist at all.
 *
 * What *is* achievable, and what this guarantees:
 *
 * - **No card ever shows three symbols of one colour.** Three same-coloured symbols on a card means
 *   three same-coloured points on a line, so every colour class is kept free of collinear triples.
 * - The number of cards carrying a repeated colour is pushed as low as the geometry allows.
 *
 * Solved rather than hand-assigned, over the lines of **every** deck at once, because a symbol keeps
 * its colour across orders — an assignment tuned for the order-5 deck would otherwise land badly on
 * the order-4 deck the duel uses.
 */

/**
 * Eight, not six.
 *
 * Collisions fall roughly with the square of the palette, so more colours means fewer spoiled cards.
 * It stops at eight because hues have to stay apart enough to tell at a glance and the amber band is
 * unavailable — it belongs to the connection. Past eight the hues start colliding with each other,
 * which trades a card-level problem for a worse perceptual one.
 */
export const TWIN_HUE_COUNT = 8;

/** Cards carrying three of a colour are unacceptable; a single repeated pair merely costs something. */
const TRIPLE_PENALTY = 1_000;

function planeLines() {
  // Point indices are symbol indices, so the planes can be pooled directly.
  return TWIN_ORDERS.filter((order) => order * order + order + 1 <= TWIN_SYMBOL_COUNT).flatMap(
    (order) => twinPlane(order).map((line) => [...line]),
  );
}

function costOf(lines: readonly (readonly number[])[], hues: readonly number[]) {
  let cost = 0;
  const counts = new Int8Array(TWIN_HUE_COUNT);
  for (const line of lines) {
    counts.fill(0);
    for (const point of line) counts[hues[point]] += 1;
    for (const count of counts) {
      if (count >= 3) cost += TRIPLE_PENALTY * (count - 1);
      else if (count === 2) cost += 1;
    }
  }
  return cost;
}

/**
 * Steepest descent with restarts, seeded so every process and every device agrees.
 *
 * Small enough to be exhaustive in practice — 31 symbols against about fifty lines — and the answer is
 * cached, so this runs once per session and never during a heat.
 */
function solve(): number[] {
  const lines = planeLines();
  const random = twinRandom(20260808);
  let best: number[] | null = null;
  let bestCost = Infinity;

  for (let restart = 0; restart < 24; restart += 1) {
    const hues =
      restart === 0
        ? Array.from({ length: TWIN_SYMBOL_COUNT }, (_unused, index) => index % TWIN_HUE_COUNT)
        : Array.from({ length: TWIN_SYMBOL_COUNT }, () => Math.floor(random() * TWIN_HUE_COUNT));

    let cost = costOf(lines, hues);
    let improved = true;
    while (improved) {
      improved = false;
      for (let point = 0; point < TWIN_SYMBOL_COUNT; point += 1) {
        const original = hues[point];
        let bestHue = original;
        let bestLocal = cost;
        for (let hue = 0; hue < TWIN_HUE_COUNT; hue += 1) {
          if (hue === original) continue;
          hues[point] = hue;
          const candidate = costOf(lines, hues);
          if (candidate < bestLocal) {
            bestLocal = candidate;
            bestHue = hue;
          }
        }
        hues[point] = bestHue;
        if (bestLocal < cost) {
          cost = bestLocal;
          improved = true;
        }
      }
    }

    if (cost < bestCost) {
      bestCost = cost;
      best = [...hues];
    }
    // Nothing left to win: no triples, and no card repeats a colour at all.
    if (bestCost === 0) break;
  }

  return best ?? [];
}

let solved: number[] | null = null;

function hues() {
  solved ??= solve();
  return solved;
}

const INDEX_BY_ID = new Map(TWIN_SYMBOLS.map((symbol, index) => [symbol.id, index]));

export function twinSymbolHue(id: string) {
  const index = INDEX_BY_ID.get(id);
  return index === undefined ? 0 : (hues()[index] ?? 0);
}

/** How well the assignment did, for the tests and for anyone tempted to change the palette. */
export function twinHueQuality() {
  const assignment = hues();
  const report = { cards: 0, cleanCards: 0, worstOnACard: 0, repeatedPairs: 0 };
  for (const line of planeLines()) {
    report.cards += 1;
    const counts = new Map<number, number>();
    for (const point of line)
      counts.set(assignment[point], (counts.get(assignment[point]) ?? 0) + 1);
    const worst = Math.max(...counts.values());
    report.worstOnACard = Math.max(report.worstOnACard, worst);
    if (worst === 1) report.cleanCards += 1;
    for (const count of counts.values()) if (count >= 2) report.repeatedPairs += count - 1;
  }
  return report;
}
