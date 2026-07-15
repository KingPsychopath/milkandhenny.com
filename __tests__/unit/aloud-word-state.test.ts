import { describe, expect, it } from "vitest";
import { activeWord, feedbackDurationMs, remainingWordMs } from "../../features/things/spelling-bee/aloud-word-state";

describe("aloud spelling word timing", () => {
  it("uses an absolute deadline that survives delayed timer callbacks", () => {
    const state = activeWord(30, 1_000);
    expect(state).toEqual({ status: "active", decisionClosesAt: 31_000, assistantSignal: false });
    expect(remainingWordMs(state, 6_000)).toBe(25_000);
    expect(remainingWordMs(state, 40_000)).toBe(0);
  });

  it("shows timed-out feedback for the deliberate 550 millisecond beat", () => {
    expect(feedbackDurationMs("timed_out")).toBe(550);
    expect(feedbackDurationMs("correct")).toBe(420);
  });
});
