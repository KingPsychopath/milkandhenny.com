import { heatStreaks, type HeatBand } from "./hot-and-cold-rules";

export interface HotAndColdShareGuess {
  rank: number;
  band: HeatBand;
  sequence: number;
  hint?: boolean;
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
  longestHeatStreak: number;
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

function ordinal(value: number) {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
}

/** Selects chronological personal-best milestones, never words. */
export function buildHotAndColdTrail(guesses: readonly HotAndColdShareGuess[], limit = 5) {
  if (limit <= 0 || guesses.length === 0) return [];
  const chronological = [...guesses].sort((left, right) => left.sequence - right.sequence);
  let best = Number.POSITIVE_INFINITY;
  const playerGuesses = chronological.filter(({ hint }) => !hint);
  const milestones = playerGuesses.filter((guess) => {
    if (guess.rank >= best) return false;
    best = guess.rank;
    return true;
  });
  const finalGuess = playerGuesses.at(-1);
  if (finalGuess && milestones.at(-1)?.sequence !== finalGuess.sequence)
    milestones.push(finalGuess);
  const sampledMilestones = sampleEvenly(milestones, limit);
  const includedSequences = new Set(sampledMilestones.map(({ sequence }) => sequence));
  return chronological.filter(({ hint, sequence }) => hint || includedSequences.has(sequence));
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
  const seed = result.trail.reduce(
    (value, guess) => (Math.imul(value ^ guess.rank, 16_777_619) ^ guess.sequence) >>> 0,
    (result.guessCount * 31 + hintsUsed * 17 + outcome.length) >>> 0,
  );
  const pick = (phrases: readonly string[]) => phrases[seed % phrases.length];

  if (outcome === "gave-up") {
    if (result.bestRank !== null && result.bestRank < 50)
      return pick(["left it burning.", "walked away from the flame.", "almost too hot to leave."]);
    if (result.bestRank !== null && result.bestRank < 500)
      return pick([
        "close enough to glow.",
        "stopped just short of the fire.",
        "the answer was warming up.",
      ]);
    return pick([
      "the trail stayed cold.",
      "winter won this round.",
      "never quite escaped the frost.",
    ]);
  }

  if (outcome === "round") {
    if (result.bestRank !== null && result.bestRank < 50)
      return pick([
        "the room caught fire.",
        "everyone felt the heat.",
        "the room found its spark.",
      ]);
    return pick([
      "heat moved through the room.",
      "the room followed the temperature.",
      "a shared trail through the cold.",
    ]);
  }

  if (result.guessCount <= 3 && hintsUsed === 0)
    return pick([
      "barely touched the tundra.",
      "frost never stood a chance.",
      "straight through the cold.",
    ]);
  if (result.longestHeatStreak >= 3)
    return pick([
      "caught a hot streak.",
      "the guesses started glowing.",
      "once warm, never looked back.",
    ]);
  if (result.guessCount <= 6 && hintsUsed === 0)
    return pick(["a quick thaw.", "found the warmth fast.", "a short walk to the fire."]);
  if (hintsUsed >= 2)
    return pick([
      "a guided climb to the heat.",
      "followed the compass to the flame.",
      "directions, then ignition.",
    ]);
  if (hintsUsed === 1)
    return pick([
      "one nudge lit the way.",
      "a small clue, then warmth.",
      "one compass point toward the fire.",
    ]);
  if (frostShare >= 0.6)
    return pick([
      "the long way out of the tundra.",
      "winter held on for a while.",
      "spent some time below zero.",
    ]);
  if (hotShare >= 0.5)
    return pick([
      "you lived near the flame.",
      "kept circling the fire.",
      "the trail stayed glowing.",
    ]);
  return pick([
    "from frost to fire.",
    "every guess raised the temperature.",
    "cold start, warm finish.",
  ]);
}

export function buildHotAndColdShareResult({
  label,
  guesses,
  hintsUsed = 0,
  outcome = "found",
}: {
  label: string;
  guesses: readonly HotAndColdShareGuess[];
  hintsUsed?: number;
  outcome?: HotAndColdResultOutcome;
}): HotAndColdShareResult {
  const trail = buildHotAndColdTrail(guesses);
  const playerGuesses = guesses.filter(({ hint }) => !hint);
  const ranked = playerGuesses.map(({ rank }) => rank);
  const approachRanks = ranked.filter((rank) => rank > 0);
  const bestRank = approachRanks.length
    ? Math.min(...approachRanks)
    : ranked.includes(0)
      ? 0
      : null;
  const coldestRank = ranked.length ? Math.max(...ranked) : null;
  const longestHeatStreak = heatStreaks(guesses).longest;
  const guessLabel = `${playerGuesses.length} guess${playerGuesses.length === 1 ? "" : "es"}`;
  const solved = ranked.includes(0);
  const resultSummary =
    outcome === "gave-up"
      ? `I revealed the hidden word after ${guessLabel}.`
      : outcome === "round"
        ? solved
          ? `Our room found the hidden word in ${guessLabel}.`
          : `Our room finished after ${guessLabel}.`
        : `I found the hidden word in ${guessLabel}.`;
  const hintSummary = hintsUsed ? `I used ${hintsUsed} hint${hintsUsed === 1 ? "" : "s"}.` : null;
  const closest =
    bestRank === null || bestRank === 0
      ? null
      : `${outcome === "round" ? "The" : "My"} closest guess was the ${ordinal(bestRank)} closest word.`;
  const trailSummary = trail.length
    ? `${outcome === "round" ? "Our" : "My"} trail: ${trail.map(({ band, hint }) => (hint ? "🧭" : TRAIL_SYMBOLS[band])).join(" → ")}`
    : null;
  const streakSummary =
    longestHeatStreak >= 3
      ? `${outcome === "round" ? "We had" : "I had"} ${longestHeatStreak} hot guesses in a row.`
      : null;
  const invitation = outcome === "round" ? "Can your room beat it?" : "Can you beat my trail?";

  return {
    text: [
      `Hot & Cold · ${label}`,
      resultSummary,
      trailSummary,
      hintSummary,
      closest,
      streakSummary,
      invitation,
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
    trail,
    guessCount: playerGuesses.length,
    bestRank,
    coldestRank,
    longestHeatStreak,
    distribution: buildHeatDistribution(playerGuesses),
  };
}
