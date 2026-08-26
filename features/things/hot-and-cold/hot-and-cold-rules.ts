import { gameWordIsUsable, normaliseGameWord } from "../shared/word-normalization";

export const HOT_AND_COLD_PLAYER_LIMITS = { min: 2, max: 8 } as const;
export const HOT_AND_COLD_ROUND_LIMITS = { min: 1, max: 7 } as const;
export const HOT_AND_COLD_GUESS_LIMITS = { min: 2, max: 10 } as const;
export const HOT_AND_COLD_DEFAULT_ROUNDS = 3;
export const HOT_AND_COLD_DEFAULT_GUESSES = 4;
export const HOT_AND_COLD_DEFAULT_TURN_SECONDS = 20;
/** Zero disables the turn timer. */
export const HOT_AND_COLD_TURN_SECOND_OPTIONS = [0, 10, 15, 20, 30] as const;

export type HeatBand = "found" | "burning" | "hot" | "warm" | "cool" | "cold" | "frozen";

export function heatBand(rank: number): HeatBand {
  if (rank === 0) return "found";
  if (rank < 50) return "burning";
  if (rank < 500) return "hot";
  if (rank < 5_000) return "warm";
  if (rank < 15_000) return "cool";
  if (rank < 28_000) return "cold";
  return "frozen";
}

export function prepareGuess(raw: string) {
  if (!gameWordIsUsable(raw)) return null;
  return normaliseGameWord(raw);
}

export function orderGuesses<T extends { rank: number; sequence: number }>(guesses: readonly T[]) {
  return [...guesses].sort(
    (left, right) => left.rank - right.rank || left.sequence - right.sequence,
  );
}

export function heatStreaks(
  guesses: ReadonlyArray<{ rank: number; sequence: number; hint?: boolean }>,
) {
  let current = 0;
  let longest = 0;

  for (const guess of [...guesses].sort((left, right) => left.sequence - right.sequence)) {
    if (guess.hint || guess.rank === 0) continue;
    if (guess.rank < 5_000) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  return { current, longest };
}

export function roundWinnerIds(
  guesses: ReadonlyArray<{ playerId: string; rank: number }>,
  eligiblePlayerIds: readonly string[],
) {
  const eligible = new Set(eligiblePlayerIds);
  const ranked = guesses.filter(({ playerId }) => eligible.has(playerId));
  const best = Math.min(...ranked.map(({ rank }) => rank), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(best)) return [];
  return [...new Set(ranked.filter(({ rank }) => rank === best).map(({ playerId }) => playerId))];
}
