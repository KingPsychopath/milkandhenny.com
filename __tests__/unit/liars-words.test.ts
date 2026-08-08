import { describe, expect, it } from "vitest";

import { LIARS_WORD_PAIRS } from "../../features/things/liars/liars-content.server";

/**
 * The pairing is the understudy mechanic, and quality is a judgement no test can make. What a test
 * can do is catch the mechanical faults that make a pair unplayable — and stop the bank quietly
 * shrinking or filling with duplicates as it gets edited.
 */
describe("liars word pairs", () => {
  it("is big enough that a night of rematches does not repeat", () => {
    expect(LIARS_WORD_PAIRS.length).toBeGreaterThanOrEqual(180);
  });

  it("never pairs a word with itself", () => {
    for (const { word, decoy } of LIARS_WORD_PAIRS)
      expect(decoy.toLocaleLowerCase(), word).not.toBe(word.toLocaleLowerCase());
  });

  it("has no duplicate words", () => {
    const words = LIARS_WORD_PAIRS.map(({ word }) => word.toLocaleLowerCase());
    const duplicates = words.filter((word, index) => words.indexOf(word) !== index);
    expect(duplicates).toEqual([]);
  });

  it("keeps both sides short enough to say out loud and read on a phone", () => {
    for (const { word, decoy } of LIARS_WORD_PAIRS) {
      expect(word.length, word).toBeGreaterThan(1);
      expect(word.length, word).toBeLessThanOrEqual(20);
      expect(decoy.length, decoy).toBeGreaterThan(1);
      expect(decoy.length, decoy).toBeLessThanOrEqual(20);
    }
  });

  it("keeps every entry lower case, so the deal card never shouts", () => {
    for (const { word, decoy } of LIARS_WORD_PAIRS) {
      expect(word).toBe(word.toLocaleLowerCase());
      expect(decoy).toBe(decoy.toLocaleLowerCase());
    }
  });
});
