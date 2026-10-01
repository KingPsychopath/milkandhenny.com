import { describe, expect, it } from "vitest";
import {
  applyPairsAction,
  createPairsGame,
  PAIRS_SIZES,
  pairsWinners,
  restorePairsRecord,
} from "@/features/things/pairs/pairs-rules";
import type { PairsGame } from "@/features/things/pairs/pairs-rules";
import { PAIRS_SCENARIOS, pairsScenario } from "@/features/things/pairs/pairs-scenarios";

function findPair(game: PairsGame) {
  const first = game.cards.findIndex((_, index) => !game.matched.includes(index));
  const second = game.cards.findIndex(
    (card, index) => index !== first && card.rank === game.cards[first].rank,
  );
  return [first, second];
}
function match(game: PairsGame) {
  return findPair(game).reduce(
    (state, index) => applyPairsAction(state, { type: "flip", index }),
    game,
  );
}

describe("Pairs rules", () => {
  it.each(PAIRS_SIZES)(
    "deals %s pairs with deterministic positions and different suits",
    (size) => {
      const game = createPairsGame(42, size, ["Alex", "Jo"]);
      expect(game).toEqual(createPairsGame(42, size, ["Alex", "Jo"]));
      expect(game.cards).toHaveLength(size * 2);
      for (const rank of new Set(game.cards.map((card) => card.rank))) {
        const cards = game.cards.filter((card) => card.rank === rank);
        expect(cards).toHaveLength(2);
        expect(new Set(cards.map((card) => card.suit)).size).toBe(2);
      }
      expect(game.cards).not.toEqual(createPairsGame(43, size, ["Alex", "Jo"]).cards);
    },
  );

  it("scores a pair once, blocks a third card, and keeps the same player's turn", () => {
    let game = match(createPairsGame(12, 3, ["Alex", "Jo"]));
    expect(game.scores).toEqual([1, 0]);
    expect(game.phase).toBe("review");
    expect(applyPairsAction(game, { type: "flip", index: 4 })).toBe(game);
    const matched = game.matched[0];
    game = applyPairsAction(game, { type: "continue" });
    expect(game.turn).toBe(0);
    expect(applyPairsAction(game, { type: "flip", index: matched })).toBe(game);
  });

  it("holds a miss for the room, then passes the turn without points", () => {
    const restored = restorePairsRecord(pairsScenario("mismatch"));
    expect(restored?.game).toMatchObject({
      phase: "review",
      outcome: "miss",
      turn: 0,
      tries: 1,
      scores: [0, 0],
    });
    const game = applyPairsAction(restored!.game, { type: "continue" });
    expect(game).toMatchObject({ phase: "playing", selected: [], turn: 1 });
  });

  it("rejects duplicate and invalid card choices without counting a try", () => {
    const initial = createPairsGame(3, 3, ["you"]);
    const game = applyPairsAction(initial, { type: "flip", index: 0 });
    for (const index of [0, -1, 6, 0.5, Number.NaN])
      expect(applyPairsAction(game, { type: "flip", index })).toBe(game);
    expect(game.tries).toBe(0);
  });

  it("undoes an accidental pair, including its score, and only permits one undo", () => {
    const initial = createPairsGame(32, 3, ["Alex", "Jo"]);
    const game = applyPairsAction(match(initial), { type: "undo" });
    expect(game).toEqual(initial);
    expect(applyPairsAction(game, { type: "undo" })).toBe(game);
    expect(
      applyPairsAction(applyPairsAction(match(initial), { type: "continue" }), { type: "undo" }),
    ).toEqual(initial);
  });

  it("skips an absent player's partial choice and can undo the handoff", () => {
    const initial = createPairsGame(32, 3, ["Alex", "Jo"]);
    const game = applyPairsAction(applyPairsAction(initial, { type: "flip", index: 0 }), {
      type: "skip",
    });
    expect(game).toMatchObject({ turn: 1, selected: [], tries: 0, scores: [0, 0] });
    expect(applyPairsAction(game, { type: "undo" })).toEqual(initial);
    const solo = createPairsGame(32, 3, ["you"]);
    expect(applyPairsAction(solo, { type: "skip" })).toBe(solo);
  });

  it("finishes after every pair, holds the final reveal, and allows undo of the final turn", () => {
    let game = createPairsGame(32, 3, ["you"]);
    for (let pair = 0; pair < 3; pair++) {
      game = match(game);
      expect(game.phase).toBe("review");
      game = applyPairsAction(game, { type: "continue" });
    }
    expect(game).toMatchObject({ phase: "finished", tries: 3, scores: [3] });
    expect(applyPairsAction(game, { type: "flip", index: 0 })).toBe(game);
    expect(applyPairsAction(game, { type: "undo" })).toMatchObject({
      phase: "playing",
      scores: [2],
      tries: 2,
    });
  });

  it("restores exact progress and rejects corrupt recovery journals", () => {
    const record = pairsScenario("last pair");
    expect(restorePairsRecord(JSON.parse(JSON.stringify(record)))?.game).toMatchObject({
      phase: "playing",
      scores: [5, 0],
      tries: 5,
    });
    for (const corrupt of [
      null,
      {},
      { ...record, version: 2 },
      { ...record, seed: -1 },
      { ...record, names: ["Alex", "alex"] },
      { ...record, actions: [{ type: "flip", index: 99 }] },
      { ...record, actions: [{ type: "continue" }] },
      { ...record, actions: Array.from({ length: 4001 }, () => ({ type: "undo" })) },
    ])
      expect(restorePairsRecord(corrupt)).toBeNull();
  });

  it("validates all documented scenarios and returns all tied winners", () => {
    for (const scenario of PAIRS_SCENARIOS)
      expect(restorePairsRecord(pairsScenario(scenario))).not.toBeNull();
    const tied = restorePairsRecord(pairsScenario("shared win"))!.game;
    expect(tied).toMatchObject({ phase: "finished", scores: [3, 3], tries: 6 });
    expect(pairsWinners(tied)).toEqual(["Alex", "Jo"]);
  });
});
