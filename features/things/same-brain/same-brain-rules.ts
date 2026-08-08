import type {
  SameBrainAnswer,
  SameBrainCluster,
  SameBrainRoundResult,
  SameBrainScoring,
  SameBrainTimings,
  SameBrainToggles,
} from "./types";

/**
 * Every rule in the game, pure and synchronous.
 *
 * Nothing here imports the model, or Redis, or anything that can fail. The one thing the scorer
 * needs from the outside is a similarity number, and that arrives as a function argument — which is
 * why the whole of this file can be tested with a two-line stub, and why a model that will not load
 * degrades the game rather than breaking it.
 */

export const SAME_BRAIN_PLAYER_LIMITS = { min: 3, max: 16 } as const;
export const SAME_BRAIN_MAX_NAME_LENGTH = 24;
export const SAME_BRAIN_MAX_ANSWER_LENGTH = 32;
export const SAME_BRAIN_ROUND_LIMITS = { min: 3, max: 20 } as const;
export const SAME_BRAIN_DEFAULT_ROUNDS = 8;
export const SAME_BRAIN_CONNECTED_WINDOW_MS = 25_000;
export const SAME_BRAIN_HOST_CLAIM_AFTER_MS = 60_000;

/**
 * How close two answers must sit before they count as the same answer.
 *
 * Set by sweeping `scripts/same-brain-calibrate.ts` over its 30 hand-labelled rounds, not by taste.
 * The cost of being wrong is asymmetric: merging two people who did not agree invents a herd that
 * never existed and takes points off whoever actually agreed, while failing to merge only leaves the
 * group to argue about whether "sofa" and "settee" were the same answer — which they enjoy. So this
 * is chosen for the fewest wrong merges, not the best hit rate.
 *
 * What the sweep found (exact match alone gets 14/30 rounds right, missing 21 agreeing pairs):
 *
 *   0.65   21 rounds   13 correct merges   7 wrong
 *   0.72   21 rounds   13 correct merges   7 wrong
 *   0.75   19 rounds   11 correct merges   4 wrong
 *   0.80   19 rounds   10 correct merges   1 wrong   ← here
 *   0.85   18 rounds    9 correct merges   1 wrong
 *
 * 0.72 looked appealing on hit rate and was wrong: at roughly two correct merges per mistake it
 * merged surgeon with doctor and most of the days of the week. 0.80 trades three correct merges for
 * six fewer mistakes and is the knee of the curve. Below 0.75 the model is not safe to let near a
 * score at all.
 *
 * The one wrong merge that survives everywhere is Monday with Tuesday — see the closed-set warning
 * in `same-brain-questions.ts`, which is a content problem rather than a threshold one.
 */
export const SAME_BRAIN_SIMILARITY_THRESHOLD = 0.8;

/** A clear majority beats blandness. See `scoreClusters`. */
export const SAME_BRAIN_POINTS_MAJORITY = 2;
export const SAME_BRAIN_POINTS_UNANIMOUS = 1;

export const SAME_BRAIN_DEFAULT_TOGGLES: SameBrainToggles = {
  sayItAloud: true,
  eliminateOddOne: false,
  showMachineWorking: true,
  revealAuthors: true,
};

export const SAME_BRAIN_DEFAULT_TIMINGS: SameBrainTimings = {
  prompt: 4_000,
  submit: 45_000,
  // Three to read and hold your word, then the moment itself.
  sayIt: 4_500,
  reveal: 20_000,
};

export const SAME_BRAIN_TIMING_BOUNDS: Record<keyof SameBrainTimings, [number, number]> = {
  prompt: [2_000, 20_000],
  submit: [15_000, 180_000],
  sayIt: [3_000, 20_000],
  reveal: [8_000, 120_000],
};

/**
 * How long the "now" moment lasts after the countdown reaches zero.
 *
 * Short, because everybody says one word at once and that takes about a second. Anything longer is
 * dead air before the reveal.
 *
 * The important part is what happens *before* zero: your word is on screen for the whole countdown,
 * not revealed at the end of it. An earlier version showed it only on zero, which meant each person
 * read their word and then spoke — and people finish reading at different speeds, so the room
 * staggered. That is precisely the failure the beat exists to prevent, because anyone who speaks
 * second can hear the first answer and adjust. Three seconds of holding a word you already know is
 * what makes six people land on the same instant.
 */
export const SAME_BRAIN_SAY_IT_HOLD_MS = 1_500;

/**
 * Words that carry no information about what somebody meant, and would otherwise split a herd on
 * grammar. "the beach" and "beach" are the same answer; "a dog" and "dog" are the same answer.
 */
const LEADING_NOISE = /^(?:the|a|an|some|my|your|his|her|their|its|our)\s+/;

/**
 * Reduces an answer to the thing being compared.
 *
 * This function is most of the game's fairness. Everything downstream — exact clusters, the model's
 * cache key, what the reveal groups together — is built on it, so it errs towards collapsing
 * differences that no player would defend out loud, and stops well short of stemming: "cooking" and
 * "cook" stay apart, because a group would argue about those, and arguing is the game.
 */
export function normaliseAnswer(raw: string) {
  let value = raw
    .toLocaleLowerCase()
    .normalize("NFKD")
    // Combining marks, so "café" and "cafe" agree.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    // Anything that is not a letter, digit, space or internal hyphen is punctuation around a word.
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  value = value.replace(LEADING_NOISE, "");
  // Hyphens are a spelling choice, not a meaning: "ice-cream" and "ice cream" agree.
  value = value.replace(/-+/g, " ").replace(/\s+/g, " ").trim();
  return value.slice(0, SAME_BRAIN_MAX_ANSWER_LENGTH);
}

export function answerIsUsable(raw: string) {
  return normaliseAnswer(raw).length > 0;
}

/**
 * Groups answers by normalised string. No model, no async, no threshold — this is the game's floor,
 * and on its own it is a complete and playable ruleset.
 */
export function clusterByExactMatch(answers: SameBrainAnswer[]): SameBrainCluster[] {
  const groups = new Map<string, SameBrainCluster>();
  for (const answer of answers) {
    const existing = groups.get(answer.normalised);
    if (existing) {
      existing.playerIds.push(answer.playerId);
      continue;
    }
    groups.set(answer.normalised, {
      label: answer.normalised,
      spellings: [answer.normalised],
      playerIds: [answer.playerId],
      merged: false,
    });
  }
  return [...groups.values()];
}

/**
 * Merges clusters whose answers mean the same thing.
 *
 * Deliberately conservative in three ways. It compares cluster *representatives* rather than every
 * pair, so a chain of individually-plausible hops cannot drag unrelated words into one heap. It
 * requires similarity against every member of the receiving group, not just its label, so a merge
 * has to be defensible against everything already in there. And it works largest-group-first, so
 * when a word could join two herds it joins the bigger one, which is the reading a room would give.
 *
 * `similarity` returns 0..1 and must be symmetric. It is injected — tests pass a lookup table, and
 * a model that failed to load simply never gets here.
 *
 * Equal-sized groups keep the order they arrived in, which is first-answered first, so the group's
 * label is the earliest spelling somebody actually typed. The sort must therefore stay stable and
 * must not fall back to comparing labels: ordering ties alphabetically would make the reveal say
 * "sea counted as ocean" or "ocean counted as sea" depending on nothing a player can see.
 */
export function upgradeClusters(
  clusters: SameBrainCluster[],
  similarity: (a: string, b: string) => number,
  threshold = SAME_BRAIN_SIMILARITY_THRESHOLD,
): SameBrainCluster[] {
  const ordered = [...clusters].sort(
    (left, right) => right.playerIds.length - left.playerIds.length,
  );
  const merged: SameBrainCluster[] = [];

  for (const cluster of ordered) {
    const target = merged.find((candidate) =>
      candidate.spellings.every((spelling) => similarity(spelling, cluster.label) >= threshold),
    );
    if (!target) {
      merged.push({
        ...cluster,
        spellings: [...cluster.spellings],
        playerIds: [...cluster.playerIds],
      });
      continue;
    }
    target.playerIds.push(...cluster.playerIds);
    target.spellings.push(...cluster.spellings);
    target.merged = true;
  }

  return merged;
}

/**
 * Picks the herd and awards points.
 *
 * Three outcomes, and the middle one is the reason the game is worth playing:
 *
 * - One group is strictly biggest and holds at least two people. They score.
 * - Two or more groups tie for biggest. Nobody scores. A room that split down the middle has said
 *   something interesting and does not need a winner.
 * - Everybody gave the same answer. They score, but less. This is the guard against the degenerate
 *   strategy: if agreement always paid the same, the best play would be to type the blandest word
 *   available every round and never think again. Making a *contested* herd worth double means the
 *   safe answer is the cheap one, and nobody has to be told that in the rules.
 *
 * `playerCount` is how many people are still in the game, not how many answered. Three people
 * agreeing while two put their phones down is a majority, not a unanimous room, and paying it the
 * lower rate would punish the herd for somebody else's dead battery.
 */
export function scoreClusters(clusters: SameBrainCluster[], playerCount: number) {
  const sorted = [...clusters].sort(
    (left, right) => right.playerIds.length - left.playerIds.length,
  );
  const largest = sorted[0];
  if (!largest || largest.playerIds.length < 2)
    return { herdIndex: null, pointsEach: 0, noScoreReason: "split" as const };

  const tied = sorted.filter(({ playerIds }) => playerIds.length === largest.playerIds.length);
  if (tied.length > 1) return { herdIndex: null, pointsEach: 0, noScoreReason: "split" as const };

  const unanimous = largest.playerIds.length === playerCount;
  return {
    herdIndex: clusters.indexOf(largest),
    pointsEach: unanimous ? SAME_BRAIN_POINTS_UNANIMOUS : SAME_BRAIN_POINTS_MAJORITY,
    noScoreReason: null,
  };
}

/**
 * The odd one out: exactly one player, alone in their answer, while a herd formed without them.
 *
 * Under the default rules this is only a label the reveal puts on somebody, and it is deliberately
 * strict — with two loners nobody is *the* odd one, and with no herd there is nothing to be odd
 * against. Under `eliminateOddOne` it is also who leaves, which is why it may never be a judgement
 * call: it falls out of the grouping or it does not happen.
 */
export function oddPlayerOf(clusters: SameBrainCluster[], herdIndex: number | null) {
  if (herdIndex === null) return null;
  const loners = clusters.filter(({ playerIds }) => playerIds.length === 1);
  if (loners.length !== 1) return null;
  return loners[0].playerIds[0];
}

/** What the reveal says about the model, in the model's own terms, so a group can overrule it. */
export function machineNoteOf(clusters: SameBrainCluster[]) {
  const merged = clusters.filter(
    ({ merged: wasMerged, spellings }) => wasMerged && spellings.length > 1,
  );
  if (merged.length === 0) return null;
  return merged
    .map((cluster) => {
      const [first, ...rest] = cluster.spellings;
      return `${rest.join(" and ")} counted as ${first}`;
    })
    .join("; ");
}

/**
 * The whole scoring pass for one round, from raw answers to a result the reveal can render.
 *
 * `similarity` may be null — because the model is off, or because it did not load. The round still
 * scores; it just scores on spelling alone.
 */
export function scoreRound(input: {
  round: number;
  question: string;
  answers: SameBrainAnswer[];
  /** People still in the game, including anyone who did not answer. */
  playerCount: number;
  scoring: SameBrainScoring;
  similarity: ((a: string, b: string) => number) | null;
  threshold?: number;
}): SameBrainRoundResult {
  const exact = clusterByExactMatch(input.answers);
  const useModel = input.scoring === "embedding" && input.similarity !== null;
  const clusters = useModel
    ? upgradeClusters(exact, input.similarity as (a: string, b: string) => number, input.threshold)
    : exact;

  const { herdIndex, pointsEach, noScoreReason } = scoreClusters(clusters, input.playerCount);
  return {
    round: input.round,
    question: input.question,
    answers: input.answers,
    clusters,
    herdIndex,
    pointsEach,
    oddPlayerId: oddPlayerOf(clusters, herdIndex),
    machineNote: useModel ? machineNoteOf(clusters) : null,
    noScoreReason,
  };
}

/** Ranking for the ending. Ties are shared outright rather than broken on a tiebreak nobody agreed to. */
export function winnersOf(players: Array<{ id: string; score: number; out: boolean }>) {
  const eligible = players.filter(({ out }) => !out);
  const pool = eligible.length > 0 ? eligible : players;
  const best = Math.max(...pool.map(({ score }) => score), 0);
  if (best === 0) return [];
  return pool.filter(({ score }) => score === best).map(({ id }) => id);
}

export function sameBrainTimings(overrides?: Partial<SameBrainTimings>): SameBrainTimings {
  const merged = { ...SAME_BRAIN_DEFAULT_TIMINGS, ...overrides };
  for (const key of Object.keys(SAME_BRAIN_TIMING_BOUNDS) as Array<keyof SameBrainTimings>) {
    const [low, high] = SAME_BRAIN_TIMING_BOUNDS[key];
    merged[key] = Math.max(low, Math.min(high, merged[key]));
  }
  return merged;
}
