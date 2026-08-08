import { describe, expect, it } from "vitest";

import {
  dealTwin,
  planTwinDeck,
  TWIN_MIN_HAND,
  TWIN_MAX_HAND,
  TWIN_MAX_PLAYERS,
  twinAvailableOrders,
  twinDeck,
  twinDeckCapacity,
  twinMatch,
  twinMaxPlayers,
  twinPlane,
  twinSymbolsPerCard,
} from "../../features/things/twin/twin-deck";
import {
  TWIN_SYMBOL_COUNT,
  TWIN_SYMBOLS,
  twinSymbol,
} from "../../features/things/twin/twin-symbols";

/**
 * Order 4 is the one that matters most here. It is the duel deck, it is not prime, and the common
 * version of this construction uses `% n` throughout — which works for 3, 5 and 7 and silently
 * produces an order-4 deck whose cards share two symbols or none.
 */
const ORDERS = [3, 4, 5, 7, 8, 9];

/** Every prime-power order, including the two beyond what the symbol set can currently paint. */
describe("the projective plane", () => {
  for (const order of ORDERS) {
    describe(`order ${order}`, () => {
      const lines = twinPlane(order);
      const capacity = twinDeckCapacity(order);

      it("holds n² + n + 1 cards", () => {
        expect(lines).toHaveLength(capacity);
      });

      it("gives every card n + 1 symbols", () => {
        for (const line of lines) expect(line).toHaveLength(twinSymbolsPerCard(order));
      });

      it("uses n² + n + 1 distinct symbols", () => {
        expect(new Set(lines.flat()).size).toBe(capacity);
      });

      it("puts every symbol on exactly n + 1 cards", () => {
        const frequency = new Map<number, number>();
        for (const line of lines)
          for (const point of line) frequency.set(point, (frequency.get(point) ?? 0) + 1);
        expect(frequency.size).toBe(capacity);
        for (const count of frequency.values()) expect(count).toBe(twinSymbolsPerCard(order));
      });

      it("never repeats a symbol on one card", () => {
        for (const line of lines) expect(new Set(line).size).toBe(line.length);
      });

      /** The rule the whole game rests on. Everything else in twin is downstream of it. */
      it("shares exactly one symbol between every pair of cards", () => {
        const offenders: string[] = [];
        for (let i = 0; i < lines.length; i += 1)
          for (let j = i + 1; j < lines.length; j += 1) {
            const shared = lines[i].filter((point) => lines[j].includes(point));
            if (shared.length !== 1) offenders.push(`${i}×${j} shares ${shared.length}`);
          }
        expect(offenders).toEqual([]);
      });

      it("is stable across calls", () => {
        expect(twinPlane(order)).toEqual(lines);
      });
    });
  }
});

describe("the painted deck", () => {
  for (const order of [4, 5]) {
    it(`paints order ${order} with real symbol ids`, () => {
      const cards = twinDeck(order);
      expect(cards).toHaveLength(twinDeckCapacity(order));
      for (const card of cards) {
        expect(card.symbolIds).toHaveLength(twinSymbolsPerCard(order));
        for (const id of card.symbolIds) expect(twinSymbol(id)).toBeTruthy();
      }
      expect(twinMatch(cards[0], cards[1])).toBe(
        cards[0].symbolIds.find((id) => cards[1].symbolIds.includes(id)),
      );
      expect(twinDeck(order).map(({ id }) => id)).toEqual(cards.map(({ id }) => id));
    });
  }

  it("refuses an order it has no symbols for", () => {
    expect(() => twinDeck(7)).toThrow(/31 symbols/);
  });
});

describe("the symbol set", () => {
  it("has no duplicate ids or names", () => {
    expect(new Set(TWIN_SYMBOLS.map(({ id }) => id)).size).toBe(TWIN_SYMBOLS.length);
    expect(new Set(TWIN_SYMBOLS.map(({ name }) => name)).size).toBe(TWIN_SYMBOLS.length);
  });

  it("draws something for every symbol", () => {
    for (const symbol of TWIN_SYMBOLS)
      expect(symbol.paths.length + (symbol.fills?.length ?? 0)).toBeGreaterThan(0);
  });

  it("fills a whole order-5 deck", () => {
    expect(TWIN_SYMBOL_COUNT).toBeGreaterThanOrEqual(twinDeckCapacity(5));
  });

  it("only offers orders it has the symbols for", () => {
    expect(twinAvailableOrders(31)).toEqual([4, 5]);
    expect(twinAvailableOrders(57)).toEqual([4, 5, 7]);
    expect(twinAvailableOrders(20)).toEqual([]);
  });
});

describe("deck sizing", () => {
  it("matches the published table at the default hand", () => {
    // §2.2, with the full 57-symbol set available.
    const plan = (players: number) => planTwinDeck(players, 6, 57);
    expect(plan(2)).toEqual({ order: 4, handSize: 6 });
    expect(plan(3)).toEqual({ order: 4, handSize: 6 });
    expect(plan(4)).toEqual({ order: 5, handSize: 6 });
    expect(plan(5)).toEqual({ order: 5, handSize: 6 });
    expect(plan(6)).toEqual({ order: 7, handSize: 6 });
    expect(plan(9)).toEqual({ order: 7, handSize: 6 });
    // Past the ceiling the hand shrinks rather than the card growing a ninth symbol.
    expect(plan(10)).toEqual({ order: 7, handSize: 5 });
    expect(plan(12)).toEqual({ order: 7, handSize: 4 });
  });

  it("shrinks the hand when only 31 symbols are drawn", () => {
    expect(planTwinDeck(5, 6, 31)).toEqual({ order: 5, handSize: 6 });
    expect(planTwinDeck(6, 6, 31)).toEqual({ order: 5, handSize: 5 });
  });

  /**
   * The invariant behind the whole sizing rule: two identical cards share every symbol, so the match
   * stops being unique and the answer stops being checkable.
   */
  it("plans within the deck for every table at every hand size", () => {
    for (let players = 2; players <= TWIN_MAX_PLAYERS; players += 1)
      for (let hand = TWIN_MIN_HAND; hand <= TWIN_MAX_HAND; hand += 1) {
        const plan = planTwinDeck(players, hand, 57);
        if (!plan) continue;
        expect(players * plan.handSize + 1).toBeLessThanOrEqual(twinDeckCapacity(plan.order));
      }
  });

  it("never deals a duplicate card, for every table this build can seat", () => {
    for (let players = 2; players <= twinMaxPlayers(); players += 1)
      for (let hand = TWIN_MIN_HAND; hand <= TWIN_MAX_HAND; hand += 1) {
        const plan = planTwinDeck(players, hand);
        if (!plan) continue;
        const deal = dealTwin(plan, players, players * 100 + hand);
        const dealt = [...deal.hands.flat().map(({ id }) => id), deal.middle.id];
        expect(new Set(dealt).size).toBe(dealt.length);
        expect(deal.hands.every((cards) => cards.length === plan.handSize)).toBe(true);
      }
  });

  it("refuses a table it cannot deal", () => {
    expect(planTwinDeck(40, 10, 57)).toBeNull();
  });

  it("caps the table below what the deck would allow", () => {
    // 57 cards would seat eighteen at a hand of three. Twelve is where a party still works.
    expect(twinMaxPlayers(57)).toBe(TWIN_MAX_PLAYERS);
    expect(twinMaxPlayers(31)).toBe(10);
  });

  it("clamps a silly hand size instead of failing", () => {
    expect(planTwinDeck(4, 99, 57)?.handSize).toBe(TWIN_MAX_HAND);
    expect(planTwinDeck(4, 0, 57)?.handSize).toBe(TWIN_MIN_HAND);
  });
});

describe("dealing", () => {
  const plan = { order: 5, handSize: 6 } as const;

  it("is reproducible from a seed", () => {
    expect(dealTwin(plan, 4, 1234)).toEqual(dealTwin(plan, 4, 1234));
  });

  it("differs between seeds", () => {
    const first = dealTwin(plan, 4, 1).hands[0].map(({ id }) => id);
    const second = dealTwin(plan, 4, 2).hands[0].map(({ id }) => id);
    expect(first).not.toEqual(second);
  });

  it("always leaves a real match between the middle card and every top card", () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const deal = dealTwin(plan, 5, seed);
      for (const hand of deal.hands) expect(twinMatch(hand[0], deal.middle)).toBeTruthy();
    }
  });

  it("throws rather than deal a deck it has already exhausted", () => {
    expect(() => dealTwin({ order: 4, handSize: 10 }, 5, 1)).toThrow(/cards/);
  });
});
