export type AloudDecision = "correct" | "incorrect" | "skipped" | "timed_out";
export type AloudEvaluationReason = "possibly-complete" | "time-up";
export const TIMED_OUT_FEEDBACK_MS = 550;
const STANDARD_FEEDBACK_MS = 420;

export type AloudWordState =
  | { status: "idle" }
  | { status: "presenting" }
  | { status: "active"; decisionClosesAt?: number; assistantSignal: boolean }
  | { status: "paused"; remainingMs?: number }
  | { status: "local-evaluation"; reason: AloudEvaluationReason; remainingMs?: number }
  | { status: "remote-grace"; decisionClosesAt: number; graceEndsAt: number }
  | { status: "feedback"; decision: AloudDecision };

export function activeWord(timerSeconds: number, now = Date.now()): AloudWordState {
  return { status: "active", decisionClosesAt: timerSeconds > 0 ? now + timerSeconds * 1_000 : undefined, assistantSignal: false };
}

export function remainingWordMs(state: AloudWordState, now = Date.now()) {
  if (state.status === "active") return state.decisionClosesAt === undefined ? undefined : Math.max(0, state.decisionClosesAt - now);
  if (state.status === "paused" || state.status === "local-evaluation") return state.remainingMs;
  return undefined;
}

export function feedbackDurationMs(decision: AloudDecision) {
  return decision === "timed_out" ? TIMED_OUT_FEEDBACK_MS : STANDARD_FEEDBACK_MS;
}
