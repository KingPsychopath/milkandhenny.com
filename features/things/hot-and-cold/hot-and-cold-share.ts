import type { HeatBand } from "./hot-and-cold-rules";

export interface HotAndColdShareGuess {
  rank: number;
  band: HeatBand;
  sequence: number;
}

export type HotAndColdResultOutcome = "found" | "gave-up" | "round";
export type HeatDistributionZone = "frost" | "cool" | "warm" | "hot";

export interface HeatDistribution {
  zone: HeatDistributionZone;
  count: number;
  intensity: number;
}

export interface HotAndColdShareResult {
  text: string;
  trail: HotAndColdShareGuess[];
  guessCount: number;
  bestRank: number | null;
  coldestRank: number | null;
  distribution: HeatDistribution[];
}

const TRAIL_SYMBOLS: Record<HeatBand, string> = {
  found: "💡",
  burning: "❤️‍🔥",
  hot: "🔥",
  warm: "☀️",
  cool: "🔹",
  cold: "❄️",
  frozen: "🧊",
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

function buildHeatDistribution(guesses: readonly HotAndColdShareGuess[]): HeatDistribution[] {
  const counts: Record<HeatDistributionZone, number> = { frost: 0, cool: 0, warm: 0, hot: 0 };
  for (const { band } of guesses) {
    if (band === "found") continue;
    if (band === "frozen" || band === "cold") counts.frost += 1;
    else if (band === "cool") counts.cool += 1;
    else if (band === "warm") counts.warm += 1;
    else counts.hot += 1;
  }
  const highestCount = Math.max(...Object.values(counts), 0);
  return (Object.entries(counts) as Array<[HeatDistributionZone, number]>).map(([zone, count]) => ({
    zone,
    count,
    intensity: highestCount ? count / highestCount : 0,
  }));
}

export function describeHotAndColdResult({
  result,
  hintsUsed,
  outcome,
}: {
  result: HotAndColdShareResult;
  hintsUsed: number;
  outcome: HotAndColdResultOutcome;
}) {
  const countFor = (zone: HeatDistributionZone) =>
    result.distribution.find((item) => item.zone === zone)?.count ?? 0;
  const approachCount = result.distribution.reduce((total, item) => total + item.count, 0);
  const frostShare = approachCount ? countFor("frost") / approachCount : 0;
  const hotShare = approachCount ? countFor("hot") / approachCount : 0;

  if (outcome === "gave-up") {
    if (result.bestRank !== null && result.bestRank < 50) return "left it burning.";
    if (result.bestRank !== null && result.bestRank < 500) return "close enough to glow.";
    return "the trail stayed cold.";
  }

  if (outcome === "round") {
    if (result.bestRank !== null && result.bestRank < 50) return "the room caught fire.";
    return "heat moved through the room.";
  }

  if (result.guessCount <= 3 && hintsUsed === 0) return "barely touched the tundra.";
  if (result.guessCount <= 6 && hintsUsed === 0) return "a quick thaw.";
  if (hintsUsed >= 2) return "a guided climb to the heat.";
  if (frostShare >= 0.6) return "the long way out of the tundra.";
  if (hotShare >= 0.5) return "you lived near the flame.";
  return "from frost to fire.";
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
    ? trail.map(({ band }) => TRAIL_SYMBOLS[band]).join(" → ")
    : "—";
  const outcomeSummary = [guessLabel, hintsUsed > 0 ? "🧭".repeat(hintsUsed) : null]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return {
    text: [`Hot & Cold · ${label}`, trailSummary, outcomeSummary, closest].join("\n"),
    trail,
    guessCount: guesses.length,
    bestRank,
    coldestRank,
    distribution: buildHeatDistribution(guesses),
  };
}
