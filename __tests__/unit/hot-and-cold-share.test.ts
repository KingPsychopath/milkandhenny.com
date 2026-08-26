import { describe, expect, it } from "vitest";
import {
  buildHotAndColdShareResult,
  describeHotAndColdResult,
} from "../../features/things/hot-and-cold/hot-and-cold-share";

describe("hot and cold result sharing", () => {
  it("builds a chronological spoiler-free trail", () => {
    const result = buildHotAndColdShareResult({
      label: "daily #12",
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
    expect(result.text).toBe("Hot & Cold · daily #12\n🧊 → 🔹 → 🔥 → 💡\n5 guesses\nClosest #400");
    expect(result.text).not.toContain("secret");
    expect(result.distribution).toEqual([
      { zone: "frost", count: 2, intensity: 1 },
      { zone: "cool", count: 1, intensity: 0.5 },
      { zone: "warm", count: 0, intensity: 0 },
      { zone: "hot", count: 1, intensity: 0.5 },
    ]);
  });

  it("shows one compass for each hint", () => {
    const result = buildHotAndColdShareResult({
      label: "daily #16",
      guesses: [
        { sequence: 1, rank: 6_000, band: "cool" },
        { sequence: 2, rank: 80, band: "hot" },
        { sequence: 3, rank: 0, band: "found" },
      ],
      hintsUsed: 2,
    });

    expect(result.text).toBe("Hot & Cold · daily #16\n🔹 → 🔥 → 💡\n3 guesses · 🧭🧭\nClosest #80");
  });

  it("does not include fields that could reveal guessed words", () => {
    const guess = { sequence: 1, rank: 0, band: "found" as const, word: "volcano" };
    const result = buildHotAndColdShareResult({
      label: "daily #13",
      guesses: [guess],
    });

    expect(result.text).not.toContain(guess.word);
    expect(result.text).toContain("Exact on the first guess");
  });

  it("describes a near miss differently from a quick solve", () => {
    const nearMiss = buildHotAndColdShareResult({
      label: "daily #14",
      guesses: [{ sequence: 1, rank: 24, band: "burning" }],
    });
    const quickSolve = buildHotAndColdShareResult({
      label: "daily #15",
      guesses: [
        { sequence: 1, rank: 8_000, band: "cool" },
        { sequence: 2, rank: 0, band: "found" },
      ],
    });

    expect(describeHotAndColdResult({ result: nearMiss, hintsUsed: 0, outcome: "gave-up" })).toBe(
      "left it burning.",
    );
    expect(describeHotAndColdResult({ result: quickSolve, hintsUsed: 0, outcome: "found" })).toBe(
      "barely touched the tundra.",
    );
  });
});
