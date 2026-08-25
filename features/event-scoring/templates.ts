import type { ActivityTemplate, ScoreRule } from "./types";

export type EventScoringTemplate = {
  id: string;
  label: string;
  kind: "activity" | "discovery";
  activityTemplate: ActivityTemplate;
  method?: "qr" | "code" | "word" | "phrase" | "collected-clues";
  rule: ScoreRule;
};

const fixed = (points: number, repeat: ScoreRule["repeat"] = "once"): ScoreRule => ({
  mode: "fixed",
  fixedPoints: points,
  repeat,
  requiresCheckIn: true,
});

export const EVENT_SCORING_TEMPLATES: readonly EventScoringTemplate[] = [
  {
    id: "hidden-qr-hunt",
    label: "Hidden QR hunt",
    kind: "discovery",
    activityTemplate: "discovery",
    method: "qr",
    rule: fixed(5),
  },
  {
    id: "first-finders",
    label: "First finders",
    kind: "discovery",
    activityTemplate: "discovery",
    method: "qr",
    rule: fixed(10),
  },
  {
    id: "collect-them-all",
    label: "Collect them all",
    kind: "discovery",
    activityTemplate: "discovery",
    method: "collected-clues",
    rule: fixed(3),
  },
  {
    id: "secret-word",
    label: "Secret word",
    kind: "discovery",
    activityTemplate: "discovery",
    method: "word",
    rule: fixed(5),
  },
  {
    id: "three-word-phrase",
    label: "Three-word phrase",
    kind: "discovery",
    activityTemplate: "discovery",
    method: "phrase",
    rule: fixed(8),
  },
  {
    id: "timed-qr",
    label: "Timed QR",
    kind: "discovery",
    activityTemplate: "discovery",
    method: "qr",
    rule: fixed(10),
  },
  {
    id: "completion-station",
    label: "Completion station",
    kind: "activity",
    activityTemplate: "completion",
    rule: fixed(5),
  },
  {
    id: "winner-award",
    label: "Winner award",
    kind: "activity",
    activityTemplate: "winner",
    rule: fixed(10, "repeat"),
  },
  {
    id: "participation-award",
    label: "Participation award",
    kind: "activity",
    activityTemplate: "participation",
    rule: { ...fixed(3), mode: "participation", participationPoints: 3 },
  },
  {
    id: "staff-spot-award",
    label: "Staff spot award",
    kind: "activity",
    activityTemplate: "scan-to-award",
    rule: fixed(5, "repeat"),
  },
  {
    id: "check-in-bonus",
    label: "Check-in bonus",
    kind: "activity",
    activityTemplate: "check-in",
    rule: { ...fixed(2), requiresCheckIn: false },
  },
  {
    id: "audience-choice",
    label: "Audience choice",
    kind: "activity",
    activityTemplate: "audience-vote",
    rule: fixed(10),
  },
  {
    id: "one-off-prize",
    label: "One-off prize",
    kind: "activity",
    activityTemplate: "free-form",
    rule: fixed(10),
  },
] as const;

export function scoringTemplate(id: string): EventScoringTemplate | undefined {
  return EVENT_SCORING_TEMPLATES.find((template) => template.id === id);
}

export function estimateMaximumIssue(input: {
  rule: ScoreRule;
  expectedAttendance: number;
  claimantLimit?: number;
}): number | undefined {
  const people = Math.max(0, Math.trunc(input.claimantLimit ?? input.expectedAttendance));
  if (input.rule.mode === "fixed") return people * Math.max(0, input.rule.fixedPoints ?? 0);
  if (input.rule.mode === "participation")
    return people * Math.max(0, input.rule.participationPoints ?? 0);
  if (input.rule.mode === "placement")
    return Object.values(input.rule.placementPoints ?? {}).reduce((sum, value) => sum + value, 0);
  if (input.rule.maximumPoints !== undefined) return people * Math.max(0, input.rule.maximumPoints);
  return undefined;
}
