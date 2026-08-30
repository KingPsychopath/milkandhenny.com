import { timingSafeEqual } from "node:crypto";

import { clearRateLimit, reserveRateLimit } from "@/lib/platform/rate-limit.server";
import type { ExamAnswers, ExamUnlockResult } from "./types";

const EXAM_PIN_ATTEMPT_LIMIT = 10;
const EXAM_PIN_WINDOW_SECONDS = 60 * 60;

const EXAM_ANSWERS: ExamAnswers = {
  "1": [
    "(a) dy/dx = 6x² − 18x + 12",
    "(b) Set 6x² − 18x + 12 = 0 → x² − 3x + 2 = 0 → (x−1)(x−2) = 0\n    x = 1 → y = 2−9+12−4 = 1  ⇒  (1, 1)\n    x = 2 → y = 16−36+24−4 = 0  ⇒  (2, 0)",
    "(c) d²y/dx² = 12x − 18\n    At x = 1: 12(1)−18 = −6 < 0 → Maximum\n    At x = 2: 12(2)−18 = 6 > 0 → Minimum",
    "(d) At x = 0: y = −4, gradient = 12\n    Normal gradient = −1/12\n    Equation: y = −(1/12)x − 4",
  ],
  "2": [
    "(a) X ~ B(20, 0.08)\n    Assumptions: independent trials, constant probability of defect.",
    "(b) P(X = 2) = C(20,2) × (0.08)² × (0.92)¹⁸ = 0.2711 (4 d.p.)",
    "(c) P(X < 3) = P(0) + P(1) + P(2)\n    = 0.1887 + 0.3282 + 0.2711 = 0.7880 (4 d.p.)",
    "(d) H₀: p = 0.08   H₁: p > 0.08 (one-tailed)\n    P(X ≥ 5) = 1 − P(X ≤ 4) = 1 − 0.9890 = 0.0110\n    0.0110 < 0.05 → Reject H₀\n    Sufficient evidence at 5% level to support the claim.",
  ],
  "3": [
    "(a) Weight 4g (39.2 N) vertically downward\n    Normal reaction R perpendicular to plane\n    Friction F acting up the plane",
    "(b) Resolving ⊥ to plane: R = 4g cos 30° = 33.95 N\n    Friction: F = μR = 0.3 × 33.95 = 10.19 N\n    Resolving ∥ to plane: 4g sin 30° − F = 4a\n    19.6 − 10.19 = 4a → a = 2.35 m s⁻²\n    Component down plane (19.6 N) > Friction (10.19 N) ∴ particle moves.",
    "(c) v² = u² + 2as = 0 + 2(2.35)(6) = 28.2\n    v = √28.2 = 5.31 m s⁻¹",
  ],
};

function pinsMatch(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return (
    candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes)
  );
}

export async function unlockExamAnswers(pin: string, sourceIp: string): Promise<ExamUnlockResult> {
  const identity = sourceIp.trim() || "unknown";
  const decision = await reserveRateLimit({
    name: "exam-pin",
    identity,
    limit: EXAM_PIN_ATTEMPT_LIMIT,
    windowSeconds: EXAM_PIN_WINDOW_SECONDS,
    globalLimit: 2_000,
  });
  if (!decision.allowed) {
    return { ok: false, error: "Too many attempts. Try again later." };
  }

  const expectedPin = process.env.EXAM_PIN?.trim() || "2030";
  if (!pinsMatch(pin.trim(), expectedPin)) {
    return { ok: false, error: "Incorrect PIN." };
  }

  await clearRateLimit("exam-pin", identity);
  return {
    ok: true,
    answers: Object.fromEntries(
      Object.entries(EXAM_ANSWERS).map(([question, answers]) => [question, [...answers]]),
    ),
  };
}
