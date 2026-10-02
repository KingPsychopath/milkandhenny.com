import { applyPairsAction, createPairsGame } from "./pairs-rules";
import type { PairsAction, PairsRecord } from "./pairs-rules";

export const PAIRS_SCENARIOS = ["default table", "mismatch", "last pair", "shared win"] as const;
export type PairsScenario = (typeof PAIRS_SCENARIOS)[number];

export function pairsScenario(name: PairsScenario): PairsRecord {
  const record: PairsRecord = {
    version: 1,
    seed: 404,
    pairCount: 6,
    names: ["Alex", "Jo"],
    actions: [],
  };
  let game = createPairsGame(record.seed, record.pairCount, record.names);
  const act = (action: PairsAction) => {
    game = applyPairsAction(game, action);
    record.actions.push(action);
  };
  if (name === "mismatch") {
    act({ type: "flip", index: 0 });
    act({ type: "flip", index: game.cards.findIndex((card) => card.rank !== game.cards[0].rank) });
  }
  if (name === "last pair" || name === "shared win") {
    for (let pair = 0; pair < (name === "last pair" ? 5 : 6); pair++) {
      const first = game.cards.findIndex((_, index) => !game.matched.includes(index));
      const second = game.cards.findIndex(
        (card, index) => index !== first && card.rank === game.cards[first].rank,
      );
      act({ type: "flip", index: first });
      act({ type: "flip", index: second });
      act({ type: "continue" });
      if (name === "shared win" && pair === 2) act({ type: "skip" });
    }
  }
  return record;
}
