import { describe, expect, it } from "vitest";
import { rankSpellingAnswers, spellingDistance } from "../../features/things/spelling-party/spelling-closeness";

describe("spelling closeness", () => {
  it("should count a neighboring letter swap as one spelling change", () => {
    expect(spellingDistance("freind", "friend")).toBe(1);
  });

  it("should rank closest answers first while sharing places for ties", () => {
    const ranked = rankSpellingAnswers([
      { name: "Maya", answer: "separate" },
      { name: "Daniel", answer: "seperate" },
      { name: "Ava", answer: "seperete" },
      { name: "Leo", answer: "" },
      { name: "Mina", answer: "seperate" },
    ], "separate");

    expect(ranked.map(({ name, distance, place }) => ({ name, distance, place }))).toEqual([
      { name: "Maya", distance: 0, place: 1 },
      { name: "Daniel", distance: 1, place: 2 },
      { name: "Mina", distance: 1, place: 2 },
      { name: "Ava", distance: 2, place: 3 },
      { name: "Leo", distance: 8, place: 4 },
    ]);
  });
});
