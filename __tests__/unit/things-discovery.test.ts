import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseThingUsage,
  recordThingVisit,
  selectThings,
} from "@/features/things/catalog-preferences";

afterEach(() => vi.unstubAllGlobals());

describe("Things discovery", () => {
  it("combines search with useful game and tool filters", () => {
    expect(selectThings("slides", "tools", "used", {}).map(({ slug }) => slug)).toEqual([
      "pitches",
    ]);
    expect(selectThings("", "solo", "used", {}).every(({ minPlayers }) => minPlayers === 1)).toBe(
      true,
    );
    expect(selectThings("", "offline", "used", {}).every(({ offline }) => offline)).toBe(true);
    expect(selectThings("", "games", "used", {}).some(({ slug }) => slug === "pitches")).toBe(
      false,
    );
    expect(selectThings("missing card", "all", "used", {})).toEqual([]);
  });

  it("raises frequently used games without changing tie order", () => {
    const defaults = selectThings("", "games", "used", {});
    const personal = selectThings("", "games", "used", { twin: 8, centre: 2 });
    expect(personal.slice(0, 2).map(({ slug }) => slug)).toEqual(["twin", "centre"]);
    expect(personal.slice(2)).toEqual(
      defaults.filter(({ slug }) => slug !== "twin" && slug !== "centre"),
    );
    const names = selectThings("", "all", "name", { twin: 8 }).map(({ name }) => name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("ignores corrupt and unknown usage and works without writable storage", () => {
    expect(
      parseThingUsage({ twin: 9, pairs: -1, centre: Infinity, mafia: "3", unknown: 100 }),
    ).toEqual({ twin: 9 });
    vi.stubGlobal("localStorage", {
      getItem: () => "{bad JSON",
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(recordThingVisit("pairs")).toEqual({ pairs: 1 });
  });
});
