import { describe, expect, it } from "vitest";

import {
  LIARS_BOARD_SIZE,
  LIARS_WORD_CATEGORIES,
  LIARS_WORD_PAIRS,
  liarsBoard,
} from "../../features/things/liars/liars-words";

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

describe("liars word categories", () => {
  it("gives every pair a category", () => {
    for (const pair of LIARS_WORD_PAIRS) expect(pair.category, pair.word).toBeTruthy();
    expect(LIARS_WORD_CATEGORIES.length).toBeGreaterThanOrEqual(5);
  });

  /**
   * The category is on screen for everyone, so a decoy that belongs to a different one hands the
   * understudy straight to the table. Whether a decoy "fits" is a judgement, but a decoy that is
   * itself a word filed under another category is a fact, and that is checkable.
   */
  it("never gives the understudy a decoy from a different category", () => {
    const categoryOf = new Map(LIARS_WORD_PAIRS.map(({ word, category }) => [word, category]));
    const crossed = LIARS_WORD_PAIRS.filter(
      ({ decoy, category }) => categoryOf.has(decoy) && categoryOf.get(decoy) !== category,
    ).map(({ word, decoy, category }) => `${word}/${decoy} (${category})`);
    expect(crossed).toEqual([]);
  });

  it("keeps every category big enough to be worth showing", () => {
    for (const category of LIARS_WORD_CATEGORIES) {
      const size = LIARS_WORD_PAIRS.filter((pair) => pair.category === category).length;
      expect(size, category).toBeGreaterThanOrEqual(8);
    }
  });
});

describe("the board", () => {
  const pick = (bound: number) => bound - 1;

  it("draws every word from the dealt word's own category", () => {
    for (const pair of LIARS_WORD_PAIRS) {
      const board = liarsBoard(pair, pick, pair.decoy);
      const categories = new Set(
        board.map(
          (word) => LIARS_WORD_PAIRS.find((each) => each.word === word)?.category ?? pair.category,
        ),
      );
      expect(categories, `${pair.word} drew from more than one category`).toEqual(
        new Set([pair.category]),
      );
    }
  });

  it("always contains the dealt word and the understudy's, so neither stands outside it", () => {
    for (const pair of LIARS_WORD_PAIRS) {
      const board = liarsBoard(pair, pick, pair.decoy);
      expect(board, pair.word).toContain(pair.word);
      expect(board, pair.decoy).toContain(pair.decoy);
    }
  });

  it("never repeats a word, which would narrow the field for free", () => {
    for (const pair of LIARS_WORD_PAIRS) {
      const board = liarsBoard(pair, pick, pair.decoy);
      expect(new Set(board).size, pair.word).toBe(board.length);
    }
  });

  it("is small where the category is small rather than padded from elsewhere", () => {
    for (const pair of LIARS_WORD_PAIRS) {
      const board = liarsBoard(pair, pick, pair.decoy);
      expect(board.length).toBeLessThanOrEqual(LIARS_BOARD_SIZE);
      expect(board.length, pair.word).toBeGreaterThanOrEqual(5);
    }
  });

  it("comes back in a stable order, so nothing about the layout hints at the answer", () => {
    const pair = LIARS_WORD_PAIRS[0];
    const first = liarsBoard(pair, () => 0, pair.decoy);
    const second = liarsBoard(pair, (bound) => bound - 1, pair.decoy);
    expect(first).toEqual(first.toSorted((a, b) => a.localeCompare(b)));
    expect(second).toEqual(second.toSorted((a, b) => a.localeCompare(b)));
  });
});
