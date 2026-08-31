import { describe, expect, it } from "vitest";

import { freshFirst, shuffledCopy } from "../../features/things/shared/content-random";

describe("shared game content rotation", () => {
  it("shuffles without mutating or losing content", () => {
    const source = ["a", "b", "c", "d"] as const;
    const result = shuffledCopy(source);
    expect(source).toEqual(["a", "b", "c", "d"]);
    expect([...result].sort()).toEqual([...source].sort());
  });

  it("puts unseen content first and ages seen content in recorded order", () => {
    const result = freshFirst(["a", "b", "c", "d", "e"], ["b", "d"], (item) => item);
    expect(new Set(result.slice(0, 3))).toEqual(new Set(["a", "c", "e"]));
    expect(result.slice(3)).toEqual(["b", "d"]);
  });

  it("ignores history entries that no longer exist in a deck", () => {
    expect(freshFirst(["a", "b"], ["removed", "a"], (item) => item)).toEqual(["b", "a"]);
  });
});
