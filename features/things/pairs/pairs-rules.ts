export const PAIRS_SIZES = [3, 6, 10] as const;
export type PairsSize = (typeof PAIRS_SIZES)[number];
export const PAIRS_RANKS = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5"];

export interface PairsCard {
  rank: string;
  suit: "♠" | "♥" | "♣" | "♦";
}

export type PairsAction =
  | { type: "flip"; index: number }
  | { type: "continue" }
  | { type: "undo" }
  | { type: "skip" };

interface PairsTurn {
  matched: number[];
  selected: number[];
  scores: number[];
  turn: number;
  tries: number;
  phase: "playing" | "review" | "finished";
  outcome: "match" | "miss" | null;
}

export interface PairsGame extends PairsTurn {
  cards: PairsCard[];
  names: string[];
  previous: PairsTurn | null;
}

/** Recovery stores a bounded command journal, then replays the same rules as live play. */
export interface PairsRecord {
  version: 1;
  seed: number;
  pairCount: PairsSize;
  names: string[];
  actions: PairsAction[];
}

export function createPairsGame(
  seed: number,
  pairCount: PairsSize,
  names: readonly string[],
): PairsGame {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Invalid shuffle");
  if (!PAIRS_SIZES.includes(pairCount) || names.length < 1 || names.length > 6)
    throw new Error("Choose a table size and one to six players");
  const trimmed = names.map((name) => name.trim());
  if (
    trimmed.some((name) => !name || name.length > 24) ||
    new Set(trimmed.map((name) => name.toLowerCase())).size !== trimmed.length
  )
    throw new Error("Give each player a different name");
  const cards: PairsCard[] = PAIRS_RANKS.slice(0, pairCount).flatMap((rank, index) => [
    { rank, suit: index % 2 === 0 ? "♠" : "♣" },
    { rank, suit: index % 2 === 0 ? "♥" : "♦" },
  ]);
  let randomState = seed;
  for (let index = cards.length - 1; index > 0; index--) {
    randomState += 0x6d2b79f5;
    let value = Math.imul(randomState ^ (randomState >>> 15), 1 | randomState);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    const target = Math.floor((((value ^ (value >>> 14)) >>> 0) / 4294967296) * (index + 1));
    [cards[index], cards[target]] = [cards[target], cards[index]];
  }
  return {
    cards,
    names: trimmed,
    scores: trimmed.map(() => 0),
    matched: [],
    selected: [],
    turn: 0,
    tries: 0,
    phase: "playing",
    outcome: null,
    previous: null,
  };
}

function checkpoint(game: PairsGame): PairsTurn {
  return {
    matched: [...game.matched],
    selected: [],
    scores: [...game.scores],
    turn: game.turn,
    tries: game.tries,
    phase: "playing",
    outcome: null,
  };
}

export function applyPairsAction(game: PairsGame, action: PairsAction): PairsGame {
  if (action.type === "undo")
    return game.previous ? { ...game, ...game.previous, previous: null } : game;
  if (action.type === "continue") {
    if (game.phase !== "review") return game;
    return {
      ...game,
      turn: game.outcome === "miss" ? (game.turn + 1) % game.names.length : game.turn,
      selected: [],
      phase: game.matched.length === game.cards.length ? "finished" : "playing",
      outcome: null,
    };
  }
  if (action.type === "skip") {
    if (game.phase !== "playing" || game.names.length === 1) return game;
    return {
      ...game,
      previous: checkpoint(game),
      selected: [],
      turn: (game.turn + 1) % game.names.length,
    };
  }
  if (
    game.phase !== "playing" ||
    !Number.isInteger(action.index) ||
    !game.cards[action.index] ||
    game.selected.includes(action.index) ||
    game.matched.includes(action.index)
  )
    return game;
  const selected = [...game.selected, action.index];
  const previous = game.selected.length === 0 ? checkpoint(game) : game.previous;
  if (selected.length === 1) return { ...game, selected, previous };
  const match = game.cards[selected[0]].rank === game.cards[selected[1]].rank;
  return {
    ...game,
    previous,
    selected,
    tries: game.tries + 1,
    phase: "review",
    outcome: match ? "match" : "miss",
    matched: match ? [...game.matched, ...selected] : game.matched,
    scores: game.scores.map((score, index) => score + (match && index === game.turn ? 1 : 0)),
  };
}

export function pairsWinners(game: PairsGame): string[] {
  const highest = Math.max(...game.scores);
  return game.names.filter((_, index) => game.scores[index] === highest);
}

function parseAction(value: unknown): PairsAction | null {
  if (!value || typeof value !== "object" || !("type" in value)) return null;
  if (value.type === "flip" && "index" in value && typeof value.index === "number")
    return Number.isInteger(value.index) && value.index >= 0 && value.index < 20
      ? { type: "flip", index: value.index }
      : null;
  if (value.type === "continue" || value.type === "undo" || value.type === "skip")
    return { type: value.type };
  return null;
}

export function restorePairsRecord(
  value: unknown,
): { record: PairsRecord; game: PairsGame } | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("seed" in value) ||
    typeof value.seed !== "number" ||
    !("pairCount" in value) ||
    (value.pairCount !== 3 && value.pairCount !== 6 && value.pairCount !== 10) ||
    !("names" in value) ||
    !Array.isArray(value.names) ||
    !("actions" in value) ||
    !Array.isArray(value.actions) ||
    value.actions.length > 4000
  )
    return null;
  const names: string[] = [];
  for (const name of value.names) {
    if (typeof name !== "string") return null;
    names.push(name);
  }
  const actions: PairsAction[] = [];
  try {
    let game = createPairsGame(value.seed, value.pairCount, names);
    for (const raw of value.actions) {
      const action = parseAction(raw);
      if (!action) return null;
      const next = applyPairsAction(game, action);
      if (next === game) return null;
      actions.push(action);
      game = next;
    }
    return {
      record: { version: 1, seed: value.seed, pairCount: value.pairCount, names, actions },
      game,
    };
  } catch {
    return null;
  }
}
