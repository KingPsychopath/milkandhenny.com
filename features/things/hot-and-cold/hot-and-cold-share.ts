import type { HeatBand } from "./hot-and-cold-rules";

export interface HotAndColdShareGuess {
  rank: number;
  band: HeatBand;
  sequence: number;
}

export interface HotAndColdShareResult {
  text: string;
  trail: HotAndColdShareGuess[];
  guessCount: number;
  bestRank: number | null;
  coldestRank: number | null;
}

const TRAIL_LABELS: Record<HeatBand, string> = {
  found: "found",
  burning: "burning",
  hot: "hot",
  warm: "warm",
  cool: "cool",
  cold: "cold",
  frozen: "frozen",
};

function sampleEvenly<T>(items: readonly T[], limit: number) {
  if (items.length <= limit) return [...items];
  return Array.from({ length: limit }, (_, index) => {
    const position = Math.round((index * (items.length - 1)) / (limit - 1));
    return items[position];
  });
}

/** Selects chronological personal-best milestones, never words. */
export function buildHotAndColdTrail(guesses: readonly HotAndColdShareGuess[], limit = 5) {
  if (limit <= 0 || guesses.length === 0) return [];
  const chronological = [...guesses].sort((left, right) => left.sequence - right.sequence);
  let best = Number.POSITIVE_INFINITY;
  const milestones = chronological.filter((guess) => {
    if (guess.rank >= best) return false;
    best = guess.rank;
    return true;
  });
  const finalGuess = chronological.at(-1);
  if (finalGuess && milestones.at(-1)?.sequence !== finalGuess.sequence)
    milestones.push(finalGuess);
  return sampleEvenly(milestones, limit);
}

export function buildHotAndColdShareResult({
  label,
  guesses,
  hintsUsed = 0,
}: {
  label: string;
  guesses: readonly HotAndColdShareGuess[];
  hintsUsed?: number;
}): HotAndColdShareResult {
  const trail = buildHotAndColdTrail(guesses);
  const ranked = guesses.map(({ rank }) => rank);
  const approachRanks = ranked.filter((rank) => rank > 0);
  const bestRank = approachRanks.length
    ? Math.min(...approachRanks)
    : ranked.includes(0)
      ? 0
      : null;
  const coldestRank = ranked.length ? Math.max(...ranked) : null;
  const guessLabel = `${guesses.length} guess${guesses.length === 1 ? "" : "es"}`;
  const closest =
    bestRank === null
      ? "No ranked guesses"
      : bestRank === 0
        ? "Exact on the first guess"
        : `Closest #${bestRank.toLocaleString("en-US")}`;
  const trailSummary = trail.length
    ? trail.map(({ band }) => TRAIL_LABELS[band]).join(" — ")
    : "no trail";
  const outcomeSummary = [
    guessLabel,
    hintsUsed > 0 ? `${hintsUsed} hint${hintsUsed === 1 ? "" : "s"}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return {
    text: [`Hot & Cold · ${label}`, trailSummary, outcomeSummary, closest].join("\n"),
    trail,
    guessCount: guesses.length,
    bestRank,
    coldestRank,
  };
}
