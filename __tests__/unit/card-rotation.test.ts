import { beforeEach, describe, expect, it } from "vitest";

const store = new Map<string, string>();
// The rotation module is browser-only; a tiny stand-in is enough to exercise its real behaviour.
Reflect.set(globalThis, "localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
});

const { rememberCards, selectRoundCards, readRecentCards } =
  await import("../../features/things/heads-up/cardRotation.client");

const deck = ["A", "B", "C", "D", "E", "F", "G", "H"];

beforeEach(() => store.clear());

describe("forehead card rotation", () => {
  it("deals unseen cards before anything the device has already played", () => {
    rememberCards("d", ["A", "B", "C"], deck.length);
    const dealt = selectRoundCards("d", deck);

    expect(dealt).toHaveLength(deck.length);
    expect([...dealt].sort()).toEqual([...deck].sort());
    // The five unplayed cards all come before any repeat.
    expect(dealt.slice(0, 5).sort()).toEqual(["D", "E", "F", "G", "H"]);
  });

  it("brings the longest-ago cards back first once the deck is used up", () => {
    rememberCards("d", deck, deck.length);
    const dealt = selectRoundCards("d", deck);

    // History is capped below the deck size, so the oldest card has already aged out and is fresh.
    expect(dealt[0]).toBe("A");
    expect(dealt.slice(1, 3)).toEqual(["B", "C"]);
  });

  it("never wedges into a fixed order, so a deck cannot dead-end", () => {
    for (let round = 0; round < 6; round += 1) {
      const dealt = selectRoundCards("d", deck);
      expect([...dealt].sort()).toEqual([...deck].sort());
      rememberCards("d", dealt, deck.length);
      expect(readRecentCards("d").length).toBeLessThan(deck.length);
    }
  });

  it("only counts the cards a round actually reached", () => {
    rememberCards("d", ["A", "B"], deck.length);
    expect(readRecentCards("d")).toEqual(["A", "B"]);

    // A round that ended immediately must not consume the deck.
    rememberCards("d", [], deck.length);
    expect(readRecentCards("d")).toEqual(["A", "B"]);
  });

  it("keeps each deck's history to itself", () => {
    rememberCards("one", ["A", "B"], deck.length);
    expect(readRecentCards("two")).toEqual([]);
  });
});
