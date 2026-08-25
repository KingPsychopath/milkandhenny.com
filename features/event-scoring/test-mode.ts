import type { ActivityStatus, ScoreRule } from "./types";

export const TEST_SCENARIOS = [
  "valid",
  "duplicate",
  "exhausted",
  "expired",
  "paused",
  "unidentified",
] as const;

export type TestScenario = (typeof TEST_SCENARIOS)[number];

export type TestModeResult = {
  state: "accepted" | "held" | "rejected";
  points: number;
  reason: string;
  ledgerWrites: 0;
  poolChange: 0;
  rankChange: 0;
};

/**
 * A deterministic rehearsal. It does not receive a store or writer, so it cannot mutate live data.
 */
export function simulateScoreClaim(input: {
  scenario: TestScenario;
  status: ActivityStatus;
  rule: ScoreRule;
  previewPoints: number;
}): TestModeResult {
  const base = { ledgerWrites: 0 as const, poolChange: 0 as const, rankChange: 0 as const };
  if (input.scenario === "unidentified")
    return { ...base, state: "held", points: 0, reason: "Participant identification is needed" };
  if (input.scenario === "duplicate")
    return { ...base, state: "rejected", points: 0, reason: "This result was already recorded" };
  if (input.scenario === "exhausted")
    return { ...base, state: "rejected", points: 0, reason: "The point pool is exhausted" };
  if (input.scenario === "expired")
    return { ...base, state: "rejected", points: 0, reason: "The activity has ended" };
  if (input.scenario === "paused" || input.status === "paused")
    return { ...base, state: "held", points: 0, reason: "The activity is paused for review" };
  return {
    ...base,
    state: "accepted",
    points: Math.max(0, Math.trunc(input.previewPoints)),
    reason: input.rule.requiresCheckIn ? "Valid after accepted check-in" : "Valid rehearsal",
  };
}
