import { describe, expect, it } from "vitest";

import {
  rankTwinFinish,
  recordTwinElapsed,
  TWIN_COOLDOWNS_MS,
  TWIN_TIMING,
  twinAwards,
  twinCooldownMs,
  twinGraceEnd,
  twinHeadline,
  twinHeatOutcome,
  twinHeatShouldClose,
  type TwinPlayerStats,
} from "../../features/things/twin/twin-rules";
import { TWIN_HEARTBEAT } from "../../features/things/twin/twin-rules";
import { twinHeartbeatGapMs } from "../../features/things/twin/twin-sound.client";
import type { TwinLoggedHeat } from "../../features/things/twin/types";

function stats(overrides: Partial<TwinPlayerStats> & { name: string }): TwinPlayerStats {
  return {
    playerId: overrides.name.toLowerCase(),
    cardsLeft: 0,
    place: null,
    connections: 0,
    misses: 0,
    longestChain: 0,
    totalElapsedMs: 0,
    bestElapsedMs: null,
    ...overrides,
  };
}

describe("wrong taps", () => {
  it("escalates the cooldown within a heat, then holds at the longest", () => {
    expect(twinCooldownMs(0)).toBe(0);
    expect(twinCooldownMs(1)).toBe(TWIN_COOLDOWNS_MS[0]);
    expect(twinCooldownMs(2)).toBe(TWIN_COOLDOWNS_MS[1]);
    expect(twinCooldownMs(3)).toBe(TWIN_COOLDOWNS_MS[2]);
    expect(twinCooldownMs(9)).toBe(TWIN_COOLDOWNS_MS[2]);
  });

  it("makes spraying strictly worse than looking", () => {
    // Six symbols sprayed buys more lockout than the whole window is long.
    const sprayed = [1, 2, 3, 4, 5, 6].reduce((total, misses) => total + twinCooldownMs(misses), 0);
    expect(sprayed).toBeGreaterThan(TWIN_TIMING.defaultWindowMs);
  });
});

describe("the heartbeat", () => {
  it("stays silent until the last few seconds", () => {
    expect(twinHeartbeatGapMs(8_000)).toBeNull();
    expect(twinHeartbeatGapMs(TWIN_HEARTBEAT.startsAtMs + 1)).toBeNull();
    expect(twinHeartbeatGapMs(TWIN_HEARTBEAT.startsAtMs)).not.toBeNull();
  });

  it("stops at zero rather than beating forever", () => {
    expect(twinHeartbeatGapMs(0)).toBeNull();
    expect(twinHeartbeatGapMs(-500)).toBeNull();
  });

  /** The whole point: the gap has to close as the clock runs down, never widen. */
  it("only ever quickens", () => {
    let previous = Infinity;
    for (let remaining = TWIN_HEARTBEAT.startsAtMs; remaining > 0; remaining -= 100) {
      const gap = twinHeartbeatGapMs(remaining);
      expect(gap).not.toBeNull();
      expect(gap!).toBeLessThanOrEqual(previous);
      previous = gap!;
    }
  });

  it("runs between the resting and racing beats", () => {
    expect(twinHeartbeatGapMs(TWIN_HEARTBEAT.startsAtMs)).toBe(TWIN_HEARTBEAT.slowestGapMs);
    expect(twinHeartbeatGapMs(1)).toBeGreaterThanOrEqual(TWIN_HEARTBEAT.fastestGapMs);
    expect(twinHeartbeatGapMs(1)).toBeLessThan(TWIN_HEARTBEAT.slowestGapMs);
  });
});

describe("the timing clamps", () => {
  const windowMs = TWIN_TIMING.defaultWindowMs;

  it("takes an honest claim as it stands", () => {
    expect(recordTwinElapsed({ claimedMs: 1_400, arrivalElapsedMs: 1_500, windowMs })).toBe(1_400);
  });

  it("floors a claim faster than a nervous system", () => {
    expect(recordTwinElapsed({ claimedMs: 5, arrivalElapsedMs: 60, windowMs })).toBe(
      TWIN_TIMING.minReactionMs,
    );
  });

  it("never lets a claim exceed the window", () => {
    expect(recordTwinElapsed({ claimedMs: 99_000, arrivalElapsedMs: 99_500, windowMs })).toBe(
      windowMs,
    );
  });

  it("bounds forgery to the latency allowance", () => {
    // Claims 250ms having actually taken about 4s. The allowance drags it back to within 900ms.
    const recorded = recordTwinElapsed({ claimedMs: 250, arrivalElapsedMs: 4_000, windowMs });
    expect(recorded).toBe(4_000 - TWIN_TIMING.latencyAllowanceMs);
  });

  /**
   * The property that matters: the allowance may only ever raise a claim towards reality. If it could
   * lower one, a slow connection would be punished — which is the whole thing this design avoids.
   */
  it("only ever raises a claim, never lowers it", () => {
    for (let claimed = 300; claimed <= 8_000; claimed += 250)
      for (let latency = 0; latency <= 3_000; latency += 250) {
        const recorded = recordTwinElapsed({
          claimedMs: claimed,
          arrivalElapsedMs: claimed + latency,
          windowMs,
        });
        expect(recorded).toBeGreaterThanOrEqual(claimed);
      }
  });

  it("cannot be gamed by claiming a negative time", () => {
    expect(
      recordTwinElapsed({ claimedMs: -5_000, arrivalElapsedMs: 400, windowMs }),
    ).toBeGreaterThanOrEqual(TWIN_TIMING.minReactionMs);
  });
});

describe("when a heat ends", () => {
  const base = { deadlineAt: 10_000, graceEndsAt: null, contenders: 4, landed: 0 };

  it("runs to the deadline when nobody finds it", () => {
    expect(twinHeatShouldClose(base, 9_999)).toBe(false);
    expect(twinHeatShouldClose(base, 10_000)).toBe(true);
  });

  it("closes on the grace once somebody has it", () => {
    const progress = { ...base, graceEndsAt: 5_000, landed: 1 };
    expect(twinHeatShouldClose(progress, 4_999)).toBe(false);
    expect(twinHeatShouldClose(progress, 5_000)).toBe(true);
  });

  it("closes early when everyone is in", () => {
    expect(twinHeatShouldClose({ ...base, landed: 4 }, 1_000)).toBe(true);
    expect(twinHeatShouldClose({ ...base, landed: 3 }, 1_000)).toBe(false);
  });

  it("does not close an empty room early", () => {
    expect(twinHeatShouldClose({ ...base, contenders: 0, landed: 0 }, 1_000)).toBe(false);
  });

  it("never lets the grace run past the deadline", () => {
    expect(twinGraceEnd(9_000, 10_000, TWIN_TIMING.defaultGraceMs)).toBe(10_000);
    expect(twinGraceEnd(1_000, 10_000, TWIN_TIMING.defaultGraceMs)).toBe(
      1_000 + TWIN_TIMING.defaultGraceMs,
    );
  });
});

describe("the payout", () => {
  it("sheds for everyone who landed it, and gives the middle to the fastest", () => {
    const outcome = twinHeatOutcome([
      { playerId: "maya", elapsedMs: 2_100, misses: 0 },
      { playerId: "abel", elapsedMs: 1_400, misses: 1 },
      { playerId: "tom", elapsedMs: null, misses: 2 },
      { playerId: "ana", elapsedMs: 3_900, misses: 0 },
    ]);
    expect(outcome.ranked).toEqual(["abel", "maya", "ana"]);
    expect(outcome.winnerPlayerId).toBe("abel");
    expect(outcome.burned).toBe(false);
  });

  it("burns the heat when nobody found it", () => {
    const outcome = twinHeatOutcome([
      { playerId: "maya", elapsedMs: null, misses: 1 },
      { playerId: "abel", elapsedMs: null, misses: 0 },
    ]);
    expect(outcome.ranked).toEqual([]);
    expect(outcome.winnerPlayerId).toBeNull();
    expect(outcome.burned).toBe(true);
  });

  it("breaks an identical time by misses, then deterministically", () => {
    const outcome = twinHeatOutcome([
      { playerId: "zed", elapsedMs: 1_000, misses: 0 },
      { playerId: "amy", elapsedMs: 1_000, misses: 0 },
      { playerId: "bob", elapsedMs: 1_000, misses: 3 },
    ]);
    expect(outcome.ranked).toEqual(["amy", "zed", "bob"]);
  });
});

describe("the final order", () => {
  it("puts an emptied hand above everything else", () => {
    const ranked = rankTwinFinish([
      stats({ name: "Maya", cardsLeft: 1, connections: 9, longestChain: 9 }),
      stats({ name: "Abel", cardsLeft: 0, place: 1, connections: 6 }),
    ]);
    expect(ranked.map(({ name }) => name)).toEqual(["Abel", "Maya"]);
  });

  it("orders two finishers by when they finished", () => {
    const ranked = rankTwinFinish([
      stats({ name: "Maya", place: 2 }),
      stats({ name: "Abel", place: 1 }),
    ]);
    expect(ranked.map(({ name }) => name)).toEqual(["Abel", "Maya"]);
  });

  it("ranks the unfinished by cards left, then misses, then time, then chain", () => {
    expect(
      rankTwinFinish([
        stats({ name: "Far", cardsLeft: 4 }),
        stats({ name: "Close", cardsLeft: 1 }),
      ]).map(({ name }) => name),
    ).toEqual(["Close", "Far"]);

    expect(
      rankTwinFinish([
        stats({ name: "Sloppy", cardsLeft: 2, misses: 5 }),
        stats({ name: "Clean", cardsLeft: 2, misses: 0 }),
      ]).map(({ name }) => name),
    ).toEqual(["Clean", "Sloppy"]);

    expect(
      rankTwinFinish([
        stats({ name: "Slow", cardsLeft: 2, totalElapsedMs: 9_000 }),
        stats({ name: "Quick", cardsLeft: 2, totalElapsedMs: 4_000 }),
      ]).map(({ name }) => name),
    ).toEqual(["Quick", "Slow"]);

    expect(
      rankTwinFinish([
        stats({ name: "Choppy", cardsLeft: 2, longestChain: 1 }),
        stats({ name: "Streaky", cardsLeft: 2, longestChain: 5 }),
      ]).map(({ name }) => name),
    ).toEqual(["Streaky", "Choppy"]);
  });
});

describe("awards", () => {
  const heats = Array.from({ length: 8 }, (_unused, index) => ({
    number: index + 1,
    middle: { cardId: `c${index}`, symbolIds: [], seed: index },
    connections: [],
    missedBy: [],
    burned: false,
  })) satisfies TwinLoggedHeat[];

  const table = [
    stats({
      name: "Abel",
      place: 1,
      connections: 8,
      longestChain: 6,
      bestElapsedMs: 900,
      totalElapsedMs: 12_000,
    }),
    stats({
      name: "Maya",
      cardsLeft: 2,
      connections: 6,
      longestChain: 3,
      misses: 4,
      bestElapsedMs: 700,
      totalElapsedMs: 15_000,
    }),
    stats({ name: "Tom", cardsLeft: 5, connections: 3, longestChain: 1, bestElapsedMs: 2_500 }),
  ];

  const byLabel = (label: string) =>
    twinAwards(table, heats).find((award) => award.label === label);

  it("gives the win to the emptied hand", () => {
    expect(byLabel("the win")).toEqual({
      label: "the win",
      name: "Abel",
      detail: "out of cards in 8 heats",
    });
  });

  it("names the longest chain without making it the win", () => {
    expect(byLabel("longest chain")?.name).toBe("Abel");
    expect(byLabel("longest chain")?.detail).toBe("6 in a row");
    expect(twinAwards(table, heats)[0].label).toBe("the win");
  });

  it("gives quickest eye to the single fastest tap, not the winner", () => {
    expect(byLabel("quickest eye")?.name).toBe("Maya");
    expect(byLabel("quickest eye")?.detail).toBe("0.70s");
  });

  it("gives the scattergun only past three wrong taps", () => {
    expect(byLabel("the scattergun")?.name).toBe("Maya");
    const careful = table.map((player) => ({ ...player, misses: 1 }));
    expect(twinAwards(careful, heats).some(({ label }) => label === "the scattergun")).toBe(false);
  });

  it("never issues an award nobody earned", () => {
    const nobody = [stats({ name: "Abel", cardsLeft: 6 }), stats({ name: "Maya", cardsLeft: 6 })];
    const awarded = twinAwards(nobody, heats).map(({ label }) => label);
    expect(awarded).not.toContain("the win");
    expect(awarded).not.toContain("longest chain");
    expect(awarded).not.toContain("quickest eye");
    expect(awarded).not.toContain("never flinched");
  });

  it("does not hand everybody the same award", () => {
    const identical = [
      stats({ name: "Abel", cardsLeft: 2, connections: 4 }),
      stats({ name: "Maya", cardsLeft: 2, connections: 4 }),
    ];
    const awarded = twinAwards(identical, heats).map(({ label }) => label);
    expect(awarded).not.toContain("most connections");
    expect(awarded).not.toContain("never flinched");
  });

  it("shares an award between everyone tied for it", () => {
    const tied = [
      stats({ name: "Abel", cardsLeft: 1, longestChain: 4 }),
      stats({ name: "Maya", cardsLeft: 1, longestChain: 4 }),
    ];
    expect(twinAwards(tied, heats).find(({ label }) => label === "longest chain")?.name).toBe(
      "Abel and Maya",
    );
  });
});

describe("the headline", () => {
  it("names whoever ran out of cards", () => {
    expect(
      twinHeadline([stats({ name: "Abel", place: 1 }), stats({ name: "Maya", cardsLeft: 3 })]),
    ).toBe("Abel is out of cards.");
  });

  it("settles for closest when nobody emptied", () => {
    expect(
      twinHeadline([stats({ name: "Abel", cardsLeft: 1 }), stats({ name: "Maya", cardsLeft: 3 })]),
    ).toBe("Abel got closest.");
  });

  it("copes with an empty table", () => {
    expect(twinHeadline([])).toBe("Nobody made it out.");
  });
});
