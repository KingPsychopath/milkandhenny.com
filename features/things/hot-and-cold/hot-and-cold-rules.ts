import { gameWordIsUsable, normaliseGameWord } from "../shared/word-normalization";

/**
 * Semantic version of every player-visible judging decision: word identity,
 * ranks, heat bands, and official hints. Persist the exact version with runs.
 */
export const HOT_AND_COLD_JUDGING_VERSIONS = ["1.0.0", "2.0.0"] as const;
export type HotAndColdJudgingVersion = (typeof HOT_AND_COLD_JUDGING_VERSIONS)[number];
export const HOT_AND_COLD_LATEST_JUDGING_VERSION: HotAndColdJudgingVersion = "2.0.0";
export const HOT_AND_COLD_ASSET_SCHEMA_VERSION = 4;

const DAILY_JUDGING_REVISIONS = [
  { fromPuzzle: 1, judgingVersion: "1.0.0" },
  { fromPuzzle: 6, judgingVersion: "2.0.0" },
] as const satisfies ReadonlyArray<{
  fromPuzzle: number;
  judgingVersion: HotAndColdJudgingVersion;
}>;

export function isHotAndColdJudgingVersion(value: unknown): value is HotAndColdJudgingVersion {
  return HOT_AND_COLD_JUDGING_VERSIONS.some((version) => version === value);
}

export function hotAndColdJudgingVersionForPuzzle(puzzle: number): HotAndColdJudgingVersion {
  let revision: HotAndColdJudgingVersion = DAILY_JUDGING_REVISIONS[0].judgingVersion;
  for (const candidate of DAILY_JUDGING_REVISIONS) {
    if (puzzle < candidate.fromPuzzle) break;
    revision = candidate.judgingVersion;
  }
  return revision;
}

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
