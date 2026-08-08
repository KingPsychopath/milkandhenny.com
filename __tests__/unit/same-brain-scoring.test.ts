import { describe, expect, it } from "vitest";
import {
  SAME_BRAIN_POINTS_MAJORITY,
  SAME_BRAIN_POINTS_UNANIMOUS,
  clusterByExactMatch,
  machineNoteOf,
  normaliseAnswer,
  oddPlayerOf,
  scoreClusters,
  scoreRound,
  upgradeClusters,
  winnersOf,
} from "../../features/things/same-brain/same-brain-rules";
import type { SameBrainAnswer } from "../../features/things/same-brain/types";

function answers(entries: Record<string, string>): SameBrainAnswer[] {
  return Object.entries(entries).map(([playerId, text]) => ({
    playerId,
    text,
    normalised: normaliseAnswer(text),
  }));
}

/**
 * A stub standing in for the model: pairs listed here are synonyms, everything else is unrelated.
 * The real similarity function is exercised by `scripts/same-brain-calibrate.ts`, not here — a unit
 * test that loaded a 23MB model would be testing ONNX, not the rules.
 */
function similarityFrom(pairs: Array<[string, string]>) {
  const same = new Set(pairs.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
  return (a: string, b: string) => (a === b ? 1 : same.has(`${a}|${b}`) ? 0.9 : 0.1);
}

describe("normaliseAnswer", () => {
  it("collapses case, whitespace and surrounding punctuation", () => {
    expect(normaliseAnswer("  Butter ")).toBe("butter");
    expect(normaliseAnswer("butter.")).toBe("butter");
    expect(normaliseAnswer("BUTTER!")).toBe("butter");
    expect(normaliseAnswer("a  lot   of   space")).toBe("lot of space");
  });

  it("drops leading articles and possessives, which carry no meaning", () => {
    expect(normaliseAnswer("the sea")).toBe("sea");
    expect(normaliseAnswer("a dog")).toBe("dog");
    expect(normaliseAnswer("my keys")).toBe("keys");
    expect(normaliseAnswer("some butter")).toBe("butter");
  });

  it("treats hyphens and apostrophes as spelling rather than meaning", () => {
    expect(normaliseAnswer("ice-cream")).toBe(normaliseAnswer("ice cream"));
    expect(normaliseAnswer("don't know")).toBe("dont know");
  });

  it("strips accents so café and cafe agree", () => {
    expect(normaliseAnswer("café")).toBe("cafe");
  });

  it("stops short of stemming, because a group would argue about those", () => {
    expect(normaliseAnswer("cooking")).not.toBe(normaliseAnswer("cook"));
    expect(normaliseAnswer("keys")).not.toBe(normaliseAnswer("key"));
  });

  it("does not treat an article inside the answer as noise", () => {
    expect(normaliseAnswer("end of the world")).toBe("end of the world");
  });

  it("returns empty for an answer with nothing in it", () => {
    expect(normaliseAnswer("   ")).toBe("");
    expect(normaliseAnswer("!!!")).toBe("");
  });
});

describe("clusterByExactMatch", () => {
  it("groups identical normalised answers", () => {
    const clusters = clusterByExactMatch(
      answers({ a: "Butter", b: "butter.", c: "the butter", d: "jam" }),
    );
    expect(clusters).toHaveLength(2);
    expect(clusters[0].playerIds).toEqual(["a", "b", "c"]);
    expect(clusters[1].playerIds).toEqual(["d"]);
  });

  it("never merges on its own", () => {
    const clusters = clusterByExactMatch(answers({ a: "sea", b: "ocean" }));
    expect(clusters).toHaveLength(2);
    expect(clusters.every(({ merged }) => !merged)).toBe(true);
  });
});

describe("upgradeClusters", () => {
  /**
   * With every group the same size there is no majority to anchor on, so the label has to come from
   * submission order. Sorting ties by label instead would have the reveal say "sea counted as ocean"
   * or the reverse depending on the alphabet, which is not a fact about the room.
   */
  it("labels an all-tied merge with the earliest answer, not the alphabetical one", () => {
    const clusters = upgradeClusters(
      clusterByExactMatch(answers({ a: "sea", b: "ocean" })),
      similarityFrom([["sea", "ocean"]]),
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].label).toBe("sea");
    expect(machineNoteOf(clusters)).toBe("ocean counted as sea");
  });

  it("merges near-misses into the larger group", () => {
    const clusters = upgradeClusters(
      clusterByExactMatch(answers({ a: "sea", b: "sea", c: "ocean" })),
      similarityFrom([["sea", "ocean"]]),
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].label).toBe("sea");
    expect(clusters[0].playerIds).toHaveLength(3);
    expect(clusters[0].merged).toBe(true);
    expect(clusters[0].spellings).toContain("ocean");
  });

  it("leaves unrelated answers alone", () => {
    const clusters = upgradeClusters(
      clusterByExactMatch(answers({ a: "sea", b: "canal", c: "river" })),
      similarityFrom([]),
    );
    expect(clusters).toHaveLength(3);
  });

  /**
   * The transitivity guard. sea~ocean and ocean~lake, but sea!~lake, so lake must not arrive in the
   * sea group by way of ocean — that is how a chain of plausible hops builds one absurd heap.
   */
  it("does not merge through a chain when the ends disagree", () => {
    const clusters = upgradeClusters(
      clusterByExactMatch(answers({ a: "sea", b: "sea", c: "ocean", d: "lake" })),
      similarityFrom([
        ["sea", "ocean"],
        ["ocean", "lake"],
      ]),
    );
    const seaGroup = clusters.find(({ label }) => label === "sea");
    expect(seaGroup?.playerIds).toHaveLength(3);
    expect(clusters.find(({ label }) => label === "lake")?.playerIds).toEqual(["d"]);
  });

  it("puts a word that could join two herds into the bigger one", () => {
    const clusters = upgradeClusters(
      clusterByExactMatch(answers({ a: "sofa", b: "sofa", c: "couch", d: "settee" })),
      similarityFrom([
        ["sofa", "settee"],
        ["couch", "settee"],
      ]),
    );
    expect(clusters.find(({ label }) => label === "sofa")?.playerIds).toEqual(["a", "b", "d"]);
  });

  it("respects the threshold", () => {
    const exact = clusterByExactMatch(answers({ a: "sea", b: "ocean" }));
    expect(upgradeClusters(exact, similarityFrom([["sea", "ocean"]]), 0.95)).toHaveLength(2);
    expect(upgradeClusters(exact, similarityFrom([["sea", "ocean"]]), 0.5)).toHaveLength(1);
  });
});

describe("scoreClusters", () => {
  it("awards the majority two points each", () => {
    const clusters = clusterByExactMatch(
      answers({ a: "spoon", b: "spoon", c: "spoon", d: "knife" }),
    );
    const scored = scoreClusters(clusters, 4);
    expect(scored.herdIndex).toBe(0);
    expect(scored.pointsEach).toBe(SAME_BRAIN_POINTS_MAJORITY);
    expect(scored.noScoreReason).toBeNull();
  });

  /** The bland-answer guard: agreeing with everybody is worth less than agreeing with some. */
  it("awards a unanimous room only one point each", () => {
    const clusters = clusterByExactMatch(answers({ a: "hammer", b: "hammer", c: "hammer" }));
    expect(scoreClusters(clusters, 3).pointsEach).toBe(SAME_BRAIN_POINTS_UNANIMOUS);
  });

  it("scores nobody when two groups tie for biggest", () => {
    const clusters = clusterByExactMatch(
      answers({ a: "pineapple", b: "pineapple", c: "anchovy", d: "anchovy" }),
    );
    const scored = scoreClusters(clusters, 4);
    expect(scored.herdIndex).toBeNull();
    expect(scored.pointsEach).toBe(0);
    expect(scored.noScoreReason).toBe("split");
  });

  it("scores nobody when everyone answered differently", () => {
    const clusters = clusterByExactMatch(answers({ a: "one", b: "two", c: "three" }));
    expect(scoreClusters(clusters, 3).herdIndex).toBeNull();
  });

  it("scores nobody when there are no answers at all", () => {
    expect(scoreClusters([], 5).herdIndex).toBeNull();
  });

  /**
   * Three agreeing while two never answered is a majority, not a unanimous room. Counting answers
   * instead of players here would quietly halve the herd's points because of a flat battery.
   */
  it("does not treat everyone-who-answered as everyone", () => {
    const clusters = clusterByExactMatch(answers({ a: "traffic", b: "traffic", c: "traffic" }));
    expect(scoreClusters(clusters, 5).pointsEach).toBe(SAME_BRAIN_POINTS_MAJORITY);
    expect(scoreClusters(clusters, 3).pointsEach).toBe(SAME_BRAIN_POINTS_UNANIMOUS);
  });

  it("reports the herd's index in the array it was given, not the sorted one", () => {
    const clusters = clusterByExactMatch(
      answers({ a: "knife", b: "spoon", c: "spoon", d: "spoon" }),
    );
    const scored = scoreClusters(clusters, 4);
    expect(scored.herdIndex).toBe(1);
    expect(clusters[scored.herdIndex as number].label).toBe("spoon");
  });
});

describe("oddPlayerOf", () => {
  it("names the single loner against a herd", () => {
    const clusters = clusterByExactMatch(answers({ a: "ice", b: "ice", c: "ice", d: "breakup" }));
    expect(oddPlayerOf(clusters, 0)).toBe("d");
  });

  it("names nobody when two people stood apart", () => {
    const clusters = clusterByExactMatch(
      answers({ a: "ice", b: "ice", c: "ice", d: "breakup", e: "exam" }),
    );
    expect(oddPlayerOf(clusters, 0)).toBeNull();
  });

  it("names nobody when there was no herd", () => {
    const clusters = clusterByExactMatch(answers({ a: "one", b: "two" }));
    expect(oddPlayerOf(clusters, null)).toBeNull();
  });
});

describe("machineNoteOf", () => {
  it("says which spellings were counted together", () => {
    const clusters = upgradeClusters(
      clusterByExactMatch(answers({ a: "sea", b: "sea", c: "ocean" })),
      similarityFrom([["sea", "ocean"]]),
    );
    expect(machineNoteOf(clusters)).toBe("ocean counted as sea");
  });

  it("says nothing when nothing was merged", () => {
    expect(machineNoteOf(clusterByExactMatch(answers({ a: "sea", b: "canal" })))).toBeNull();
  });
});

describe("scoreRound", () => {
  const spellingSplit = { a: "the sea", b: "sea", c: "ocean", d: "canal", e: "river" };
  const PLAYERS = 5;

  it("scores on spelling alone under the exact method", () => {
    const result = scoreRound({
      round: 1,
      question: "Name somewhere you would not swim",
      answers: answers(spellingSplit),
      playerCount: PLAYERS,
      scoring: "exact",
      similarity: similarityFrom([["sea", "ocean"]]),
    });
    // "the sea" normalises to "sea", so a and b agree; ocean stays out.
    expect(result.clusters.find(({ label }) => label === "sea")?.playerIds).toEqual(["a", "b"]);
    expect(result.pointsEach).toBe(SAME_BRAIN_POINTS_MAJORITY);
    expect(result.machineNote).toBeNull();
  });

  it("merges meaning under the embedding method", () => {
    const result = scoreRound({
      round: 1,
      question: "Name somewhere you would not swim",
      answers: answers(spellingSplit),
      playerCount: PLAYERS,
      scoring: "embedding",
      similarity: similarityFrom([["sea", "ocean"]]),
    });
    expect(result.clusters.find(({ label }) => label === "sea")?.playerIds).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(result.machineNote).toBe("ocean counted as sea");
  });

  /** The degradation path: the method says embedding, but no model turned up. */
  it("falls back to exact matches when there is no similarity function", () => {
    const result = scoreRound({
      round: 1,
      question: "Name somewhere you would not swim",
      answers: answers(spellingSplit),
      playerCount: PLAYERS,
      scoring: "embedding",
      similarity: null,
    });
    expect(result.clusters.find(({ label }) => label === "sea")?.playerIds).toEqual(["a", "b"]);
    expect(result.pointsEach).toBe(SAME_BRAIN_POINTS_MAJORITY);
    expect(result.machineNote).toBeNull();
  });

  it("keeps the raw text for the reveal while scoring on the normalised form", () => {
    const result = scoreRound({
      round: 2,
      question: "Name something people put on toast",
      answers: answers({ a: "Butter", b: "butter" }),
      playerCount: 2,
      scoring: "exact",
      similarity: null,
    });
    expect(result.answers.map(({ text }) => text)).toEqual(["Butter", "butter"]);
    expect(result.clusters[0].label).toBe("butter");
  });
});

describe("winnersOf", () => {
  it("returns everyone tied at the top", () => {
    expect(
      winnersOf([
        { id: "a", score: 4, out: false },
        { id: "b", score: 4, out: false },
        { id: "c", score: 2, out: false },
      ]),
    ).toEqual(["a", "b"]);
  });

  it("ignores eliminated players while any remain", () => {
    expect(
      winnersOf([
        { id: "a", score: 9, out: true },
        { id: "b", score: 3, out: false },
      ]),
    ).toEqual(["b"]);
  });

  it("returns nobody when nobody scored", () => {
    expect(
      winnersOf([
        { id: "a", score: 0, out: false },
        { id: "b", score: 0, out: false },
      ]),
    ).toEqual([]);
  });
});
