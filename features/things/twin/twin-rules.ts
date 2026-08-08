import type { TwinAward, TwinLoggedHeat } from "./types";

/**
 * The rules, as pure functions.
 *
 * Read by the engine, by the one-device boards, and by the tests. Nothing in here touches room state,
 * Redis, React or the clock except through an argument, so every rule in docs/twin.md can be driven
 * directly rather than through a game.
 */

export const TWIN_TIMING = {
  /** The lead-in while hands deal and the middle card lands. */
  dealingMs: 2_000,
  defaultWindowMs: 8_000,
  defaultGraceMs: 2_500,
  minWindowMs: 4_000,
  maxWindowMs: 15_000,
  minGraceMs: 1_000,
  maxGraceMs: 5_000,
  /**
   * The quiet beat between a heat closing and its payout. A tap made in time but delivered late still
   * counts inside it, and the result animation wants the pause anyway.
   */
  settleDelayMs: 600,
  /** How long the result stays up before the next heat deals. */
  settleHoldMs: 3_400,
  /** Faster than any human nervous system. Rejects prefiring and absurd claims. */
  minReactionMs: 220,
  /**
   * How much better than the truth a forged claim could ever be. It only raises a claim towards
   * reality, never past it, so a slow connection cannot be punished by it.
   */
  latencyAllowanceMs: 900,
} as const;

/** Escalating within a heat, so spraying is strictly worse than looking. */
export const TWIN_COOLDOWNS_MS = [1_500, 2_500, 4_000] as const;

export function twinCooldownMs(missesThisHeat: number) {
  if (missesThisHeat <= 0) return 0;
  return TWIN_COOLDOWNS_MS[Math.min(missesThisHeat, TWIN_COOLDOWNS_MS.length) - 1];
}

/**
 * What actually gets ranked.
 *
 * The client measures from its own first paint of the revealed cards to the tap, because ranking by
 * server arrival would make broadband a skill and nobody in the room can do anything about their
 * connection. The clamps bound what that trade costs — see §4.2.
 */
export function recordTwinElapsed(input: {
  claimedMs: number;
  /** Server receipt, relative to `revealAt`. */
  arrivalElapsedMs: number;
  windowMs: number;
}) {
  const claimed = Math.max(input.claimedMs, TWIN_TIMING.minReactionMs);
  const floor = input.arrivalElapsedMs - TWIN_TIMING.latencyAllowanceMs;
  // The window bounds the result, not just the claim: a recorded time outside it is not a time this
  // heat could have produced, and the allowance must not be able to push one past the deadline.
  return Math.round(Math.min(input.windowMs, Math.max(claimed, floor)));
}

/** Once somebody lands it, everybody else has the grace or the rest of the window, whichever is less. */
export function twinGraceEnd(now: number, deadlineAt: number, graceMs: number) {
  return Math.min(deadlineAt, now + graceMs);
}

export interface TwinHeatProgress {
  deadlineAt: number;
  graceEndsAt: number | null;
  /** Connected players who could still answer this heat. */
  contenders: number;
  landed: number;
}

/** First blood, the window, or everyone in — whichever comes first. */
export function twinHeatShouldClose(progress: TwinHeatProgress, now: number) {
  if (now >= progress.deadlineAt) return true;
  if (progress.graceEndsAt !== null && now >= progress.graceEndsAt) return true;
  return progress.contenders > 0 && progress.landed >= progress.contenders;
}

export interface TwinHeatEntry {
  playerId: string;
  /** Null means they never found it. */
  elapsedMs: number | null;
  misses: number;
}

export interface TwinHeatOutcome {
  /** Everyone who landed it, fastest first. All of them shed a card. */
  ranked: string[];
  /** The fastest, whose shed card becomes the next middle card. */
  winnerPlayerId: string | null;
  /** Nobody found it, so every hand rotates instead and the middle card stays. */
  burned: boolean;
}

/**
 * Everyone who lands it inside the window sheds. Only the fastest takes the middle.
 *
 * The alternative — the fastest alone sheds — means that with eight players an average person wins
 * one heat in eight and watches the rest, which is not a game. Speed still decides the middle, the
 * chain and the tie-break; finding it at all is always worth something.
 */
export function twinHeatOutcome(entries: readonly TwinHeatEntry[]): TwinHeatOutcome {
  const landed = entries
    .filter((entry): entry is TwinHeatEntry & { elapsedMs: number } => entry.elapsedMs !== null)
    .toSorted(
      (a, b) =>
        a.elapsedMs - b.elapsedMs ||
        a.misses - b.misses ||
        // Never leave the order to chance: two identical times must rank the same way everywhere.
        a.playerId.localeCompare(b.playerId),
    );
  return {
    ranked: landed.map(({ playerId }) => playerId),
    winnerPlayerId: landed[0]?.playerId ?? null,
    burned: landed.length === 0,
  };
}

export interface TwinPlayerStats {
  playerId: string;
  name: string;
  cardsLeft: number;
  /** Finishing position, set in the order hands emptied. */
  place: number | null;
  connections: number;
  misses: number;
  longestChain: number;
  totalElapsedMs: number;
  bestElapsedMs: number | null;
}

/**
 * Final order. Emptying your hand is the win, so `place` leads; everyone still holding cards is
 * ranked by how close they got, then by the tie-breaks from §6.1.
 */
export function rankTwinFinish(stats: readonly TwinPlayerStats[]) {
  return stats.toSorted((a, b) => {
    if (a.place !== null || b.place !== null) {
      if (a.place === null) return 1;
      if (b.place === null) return -1;
      return a.place - b.place;
    }
    return (
      a.cardsLeft - b.cardsLeft ||
      a.misses - b.misses ||
      a.totalElapsedMs - b.totalElapsedMs ||
      b.longestChain - a.longestChain
    );
  });
}

function names(stats: readonly TwinPlayerStats[]) {
  const list = stats.map(({ name }) => name);
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

/** Everyone tied at the top of `value`, or nothing when the best score was not worth naming. */
function leaders(
  stats: readonly TwinPlayerStats[],
  value: (player: TwinPlayerStats) => number | null,
  floor: number,
) {
  const scored = stats.filter((player) => {
    const measure = value(player);
    return measure !== null && measure >= floor;
  });
  if (scored.length === 0) return null;
  const best = Math.max(...scored.map((player) => value(player) as number));
  return { best, players: scored.filter((player) => value(player) === best) };
}

/**
 * Named awards, and only when earned — nobody wants a trophy for zero connections.
 *
 * Longest chain lives here rather than being the win. A game needs one win condition, and "I got rid
 * of my cards" is legible to a room that has had a drink in a way that "my longest unbroken run was
 * seven" is not. Chains are what empty hands anyway, so the award recognises the same excellence
 * without competing for the ending.
 */
export function twinAwards(
  stats: readonly TwinPlayerStats[],
  heats: readonly TwinLoggedHeat[],
): TwinAward[] {
  const awards: TwinAward[] = [];
  const ranked = rankTwinFinish(stats);
  const winner = ranked[0];

  if (winner && winner.place !== null)
    awards.push({
      label: "the win",
      name: winner.name,
      detail: `out of cards in ${heats.length} ${heats.length === 1 ? "heat" : "heats"}`,
    });

  const chain = leaders(stats, ({ longestChain }) => longestChain, 2);
  if (chain)
    awards.push({
      label: "longest chain",
      name: names(chain.players),
      detail: `${chain.best} in a row`,
    });

  // Lowest, not highest, so the comparison is inverted before it goes in.
  const quickest = leaders(
    stats,
    ({ bestElapsedMs }) => (bestElapsedMs === null ? null : -bestElapsedMs),
    -Infinity,
  );
  if (quickest)
    awards.push({
      label: "quickest eye",
      name: names(quickest.players),
      detail: `${(-quickest.best / 1_000).toFixed(2)}s`,
    });

  const most = leaders(stats, ({ connections }) => connections, 1);
  if (most && most.players.length < stats.length)
    awards.push({
      label: "most connections",
      name: names(most.players),
      detail: `${most.best} found`,
    });

  const flawless = stats.filter((player) => player.misses === 0 && player.connections > 0);
  if (flawless.length > 0 && flawless.length < stats.length)
    awards.push({
      label: "never flinched",
      name: names(flawless),
      detail: "not one wrong tap",
    });

  const scattergun = leaders(stats, ({ misses }) => misses, 3);
  if (scattergun)
    awards.push({
      label: "the scattergun",
      name: names(scattergun.players),
      detail: `${scattergun.best} wrong taps, and no regrets`,
    });

  return awards;
}

export function twinHeadline(stats: readonly TwinPlayerStats[]) {
  const winner = rankTwinFinish(stats)[0];
  if (!winner) return "Nobody made it out.";
  if (winner.place === null) return `${winner.name} got closest.`;
  return `${winner.name} is out of cards.`;
}
