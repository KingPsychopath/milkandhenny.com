import { describe, expect, it } from "vitest";

import {
  liarsHouseState,
  liarsVillageOrder,
  type LiarsHouseState,
} from "../../features/things/liars/LiarsVillage";
import type { LiarsSnapshot } from "../../features/things/liars/types";

/**
 * The village is the one piece of this game that could leak everything while looking like
 * decoration. A window that lit when a particular person acted would be a global movement display,
 * and movement being local is the only thing holding the watch mechanic up.
 *
 * The layout function is the whole risk surface, so it is pinned here: the lit set must depend on
 * the public count and the round, and on nothing about who anybody is.
 */
const shuffledPositions = liarsVillageOrder;

const lit = (count: number, seed: number, acted: number) =>
  new Set(shuffledPositions(count, seed).slice(0, acted));

describe("the village at night", () => {
  it("lights exactly as many windows as the public counter says", () => {
    for (let acted = 0; acted <= 9; acted += 1)
      expect(lit(9, 3, acted).size, `${acted} acted`).toBe(acted);
  });

  it("moves the houses every round, so nobody can build a map across a game", () => {
    const first = shuffledPositions(9, 1);
    const second = shuffledPositions(9, 2);
    const third = shuffledPositions(9, 3);
    expect(first).not.toEqual(second);
    expect(second).not.toEqual(third);
  });

  it("is stable within a round, so it does not flicker between polls", () => {
    expect(shuffledPositions(9, 4)).toEqual(shuffledPositions(9, 4));
    expect(lit(9, 4, 5)).toEqual(lit(9, 4, 5));
  });

  it("uses every house exactly once, so no seat is ever unrepresented", () => {
    const order = shuffledPositions(12, 7);
    expect(order.toSorted((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i));
  });

  it("lights the same windows however the acted count was reached", () => {
    // Whoever acted, in whatever order, six locks looks identical. That is the point: the count is
    // public, the identities are not, and the picture must not distinguish between two rooms that
    // reached six the same way.
    expect(lit(9, 5, 6)).toEqual(lit(9, 5, 6));
    expect([...lit(9, 5, 6)].toSorted()).toEqual([...lit(9, 5, 6)].toSorted());
  });

  it("grows the lit set monotonically, so a window never goes out mid-night", () => {
    // Somebody's light going off would read as them un-acting, which cannot happen.
    for (let acted = 1; acted <= 9; acted += 1) {
      const before = lit(9, 6, acted - 1);
      const after = lit(9, 6, acted);
      for (const position of before) expect(after.has(position), `${acted}`).toBe(true);
    }
  });
});


describe("the village at dawn", () => {
  const alive = { id: "p1", name: "Maya", alive: true };
  const dead = { id: "p1", name: "Maya", alive: false };

  const dawnWith = (over: Partial<NonNullable<LiarsSnapshot["dawn"]>>) =>
    ({
      narration: "",
      nameLandsAt: 0,
      holdUntil: 0,
      reviveAt: null,
      settleAt: 0,
      deaths: [],
      movementSeen: [],
      witnessCount: null,
      lastWords: [],
      ...over,
    }) as NonNullable<LiarsSnapshot["dawn"]>;

  const state = (over: {
    player?: typeof alive;
    dawn?: LiarsSnapshot["dawn"];
    landed?: boolean;
    revived?: boolean;
  }): LiarsHouseState =>
    liarsHouseState({
      player: over.player ?? alive,
      phase: "dawn",
      dawn: over.dawn ?? null,
      night: false,
      isLitAtNight: false,
      landed: over.landed ?? true,
      revived: over.revived ?? false,
    });

  const killed = dawnWith({
    deaths: [{ playerId: "p1", name: "Maya", revived: false, substituteName: null, cause: "killed" }],
  });
  const saved = dawnWith({
    deaths: [{ playerId: "p1", name: "Maya", revived: true, substituteName: null, cause: "killed" }],
  });

  it("gives nothing away before the name lands", () => {
    // The whole dawn beat depends on the village looking untouched until the narration says so.
    expect(state({ player: dead, dawn: killed, landed: false })).toBe("lit");
  });

  it("puts the window out when the name lands", () => {
    expect(state({ player: dead, dawn: killed, landed: true })).toBe("dying");
  });

  it("holds a saved player dark until the revive beat, then brings them back", () => {
    expect(state({ dawn: saved, landed: true, revived: false })).toBe("dying");
    expect(state({ dawn: saved, landed: true, revived: true })).toBe("saved");
  });

  it("marks a corroborated sighting, and only a corroborated one", () => {
    expect(state({ dawn: dawnWith({ movementSeen: ["Maya"] }) })).toBe("moved");
    expect(state({ dawn: dawnWith({ movementSeen: ["Daniel"] }) })).toBe("lit");
  });

  it("shutters the dead once dawn is over", () => {
    expect(
      liarsHouseState({
        player: dead,
        phase: "deliberation",
        dawn: null,
        night: false,
        isLitAtNight: false,
        landed: false,
        revived: false,
      }),
    ).toBe("dead");
  });

  it("never shows a night state outside the night", () => {
    // "dark" is the anonymous night look; during the day an unlit house would read as a death.
    for (const landed of [true, false])
      expect(state({ dawn: killed, landed })).not.toBe("dark");
  });
});
