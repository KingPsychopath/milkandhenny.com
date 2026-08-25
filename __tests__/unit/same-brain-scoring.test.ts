import { describe, expect, it } from "vitest";
import {
  SAME_BRAIN_POINTS_MAJORITY,
  SAME_BRAIN_POINTS_UNANIMOUS,
  clusterByExactMatch,
  normaliseAnswer,
  oddPlayerOf,
  scoreClusters,
  scoreRound,
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

describe("normaliseAnswer", () => {
  it("collapses case, whitespace and surrounding punctuation", () => {
    expect(normaliseAnswer("  Butter ")).toBe("butter");
    expect(normaliseAnswer("butter.")).toBe("butter");
    expect(normaliseAnswer("BUTTER!")).toBe("butter");
    expect(normaliseAnswer("a  lot   of   space")).toBe("lot of space");
  });

  it("drops leading articles and possessives", () => {
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

  it("stops short of stemming", () => {
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

  it("keeps different words separate for the room to decide", () => {
    const clusters = clusterByExactMatch(answers({ a: "sea", b: "ocean" }));
    expect(clusters).toHaveLength(2);
    expect(clusters.map(({ label }) => label)).toEqual(["sea", "ocean"]);
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
    expect(
      scoreClusters(clusterByExactMatch(answers({ a: "one", b: "two", c: "three" })), 3).herdIndex,
    ).toBeNull();
  });

  it("scores nobody when there are no answers at all", () => {
    expect(scoreClusters([], 5).herdIndex).toBeNull();
  });

  it("does not treat everyone-who-answered as everyone", () => {
    const clusters = clusterByExactMatch(answers({ a: "traffic", b: "traffic", c: "traffic" }));
    expect(scoreClusters(clusters, 5).pointsEach).toBe(SAME_BRAIN_POINTS_MAJORITY);
    expect(scoreClusters(clusters, 3).pointsEach).toBe(SAME_BRAIN_POINTS_UNANIMOUS);
  });

  it("reports the herd's index in the array it was given", () => {
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
    expect(oddPlayerOf(clusterByExactMatch(answers({ a: "one", b: "two" })), null)).toBeNull();
  });
});

describe("scoreRound", () => {
  it("normalises harmless differences but keeps different words apart", () => {
    const result = scoreRound({
      round: 1,
      question: "Name somewhere you would not swim",
      answers: answers({ a: "the sea", b: "sea", c: "ocean", d: "canal", e: "river" }),
      playerCount: 5,
    });
    expect(result.clusters.find(({ label }) => label === "sea")?.playerIds).toEqual(["a", "b"]);
    expect(result.clusters.find(({ label }) => label === "ocean")?.playerIds).toEqual(["c"]);
    expect(result.pointsEach).toBe(SAME_BRAIN_POINTS_MAJORITY);
  });

  it("keeps the raw text for the reveal while scoring on the normalised form", () => {
    const result = scoreRound({
      round: 2,
      question: "Name something people put on toast",
      answers: answers({ a: "Butter", b: "butter" }),
      playerCount: 2,
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
