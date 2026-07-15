import { describe, expect, it } from "vitest";
import { matchSpellingTranscript } from "../../features/things/spelling-bee/letterMatcher";

describe("spelling transcript matching", () => {
  it("matches spoken letter names against the expected word", () => {
    expect(matchSpellingTranscript("see ay tee", "cat")).toMatchObject({
      letters: "CAT",
      matchedCount: 3,
      complete: true,
      mismatchAt: null,
    });
  });

  it("understands double-letter phrasing", () => {
    expect(matchSpellingTranscript("bee double oh kay", "book")).toMatchObject({
      letters: "BOOK",
      complete: true,
    });
  });

  it("marks the first mismatch without accepting the word", () => {
    expect(matchSpellingTranscript("are eye tee", "run")).toMatchObject({
      letters: "RIT",
      matchedCount: 1,
      complete: false,
      mismatchAt: 1,
    });
  });

  it("accepts recognisers that collapse a spelled sequence into the complete word", () => {
    expect(matchSpellingTranscript("rhythm", "rhythm").complete).toBe(true);
  });
});
