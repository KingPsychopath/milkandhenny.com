import { describe, expect, it } from "vitest";

import { confirmedScoreDelta } from "@/features/event-scoring/ui/ScoreBalanceChange";

describe("score balance change", () => {
  it("totals accepted additions and corrections", () => {
    expect(
      confirmedScoreDelta([
        { id: "one", kind: "positive", points: 10 },
        { id: "two", kind: "negative", points: -3 },
        { id: "three", kind: "reversal", points: -2 },
      ]),
    ).toBe(5);
  });

  it("keeps held points out of the confirmed balance change", () => {
    expect(
      confirmedScoreDelta([
        { id: "one", kind: "held", points: 25 },
        { id: "two", kind: "positive", points: 2 },
      ]),
    ).toBe(2);
  });
});
