import { describe, expect, it } from "vitest";
import { buildHotAndColdShareResult } from "../../features/things/hot-and-cold/hot-and-cold-share";

describe("hot and cold result sharing", () => {
  it("builds a chronological spoiler-free trail", () => {
    const result = buildHotAndColdShareResult({
      label: "daily #12",
      outcome: "found",
      guesses: [
        { sequence: 1, rank: 70_000, band: "frozen" },
        { sequence: 2, rank: 10_000, band: "cool" },
        { sequence: 3, rank: 30_000, band: "cold" },
        { sequence: 4, rank: 400, band: "hot" },
        { sequence: 5, rank: 0, band: "found" },
      ],
    });

    expect(result.trail.map(({ sequence }) => sequence)).toEqual([1, 2, 4, 5]);
    expect(result.bestRank).toBe(400);
    expect(result.coldestRank).toBe(70_000);
    expect(result.text).toContain("found in 5 guesses");
    expect(result.text).not.toContain("secret");
  });

  it("does not include fields that could reveal guessed words", () => {
    const guess = { sequence: 1, rank: 0, band: "found" as const, word: "volcano" };
    const result = buildHotAndColdShareResult({
      label: "daily #13",
      outcome: "found",
      guesses: [guess],
    });

    expect(result.text).not.toContain(guess.word);
    expect(result.text).toContain("first guess exact");
  });
});
