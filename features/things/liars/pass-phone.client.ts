import { liarsBoard, LIARS_WORD_PAIRS } from "./liars-words";

export interface LiarsPassPhoneSeat {
  index: number;
  name: string;
  /** The word, or null for the imposters. */
  word: string | null;
  /** Everybody gets this, imposters included. It is the whole difference between bluffing and guessing. */
  category: string;
  /** A dozen words from the category, one of which is the real one. Everybody sees the same board. */
  board: string[];
}

/**
 * Deals a one-phone game entirely in the browser. No room, no server, no network — which is the
 * whole point: around a table, three minutes of codes and joining is three minutes nobody spends
 * playing.
 *
 * `crypto.getRandomValues` rather than `Math.random`, because the deal is the only secret this
 * mode has and a predictable shuffle would be the end of it.
 */
function randomInt(bound: number) {
  if (bound <= 1) return 0;
  const limit = Math.floor(0x1_0000_0000 / bound) * bound;
  const buffer = new Uint32Array(1);
  let value = limit;
  while (value >= limit) {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  }
  return value % bound;
}

export function liarsPassPhoneDeal(
  players: number,
  imposters: number,
  names: string[] = [],
  showBoard = true,
): LiarsPassPhoneSeat[] {
  const pair = LIARS_WORD_PAIRS[randomInt(LIARS_WORD_PAIRS.length)];
  const board = showBoard ? liarsBoard(pair, randomInt) : [];
  const roles: Array<string | null> = [
    ...Array.from({ length: Math.min(imposters, players - 1) }, () => null),
    ...Array.from({ length: players - Math.min(imposters, players - 1) }, () => pair.word),
  ];
  for (let index = roles.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [roles[index], roles[swap]] = [roles[swap], roles[index]];
  }

  return roles.map((word, index) => ({
    index,
    name: names[index]?.trim() || `player ${index + 1}`,
    word,
    category: pair.category,
    board,
  }));
}
