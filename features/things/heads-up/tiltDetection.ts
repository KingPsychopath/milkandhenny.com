export type TiltDecision = "correct" | "pass";

export interface TiltSample {
  pitch: number;
  time: number;
}

interface GestureCandidate {
  decision: TiltDecision;
  startedAt: number;
}

const GESTURE_THRESHOLD = 25;
const GESTURE_HOLD_MS = 120;
const NEUTRAL_RANGE = 9;
const STABLE_RANGE = 6;
export const STABLE_WINDOW_MS = 480;

function normalizedDifference(current: number, baseline: number) {
  return ((current - baseline + 540) % 360) - 180;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export class TiltGestureDetector {
  private armed = false;
  private candidate: GestureCandidate | null = null;
  private neutral: number | null = null;

  reset(neutral: number | null) {
    this.neutral = neutral;
    this.armed = false;
    this.candidate = null;
  }

  sample(pitch: number, time: number): TiltDecision | null {
    this.neutral ??= pitch;
    const difference = normalizedDifference(pitch, this.neutral);

    if (Math.abs(difference) < NEUTRAL_RANGE) {
      this.armed = true;
      this.candidate = null;
      return null;
    }
    if (!this.armed) return null;

    const decision =
      difference <= -GESTURE_THRESHOLD
        ? "correct"
        : difference >= GESTURE_THRESHOLD
          ? "pass"
          : null;
    if (decision === null) {
      this.candidate = null;
      return null;
    }

    if (this.candidate?.decision !== decision) {
      this.candidate = { decision, startedAt: time };
      return null;
    }
    if (time - this.candidate.startedAt < GESTURE_HOLD_MS) return null;

    this.armed = false;
    this.candidate = null;
    return decision;
  }
}

export function stablePitch(samples: TiltSample[], now: number) {
  if (samples.length < 5 || now - samples[0].time < STABLE_WINDOW_MS * 0.8) return null;

  const anchor = samples[0].pitch;
  const offsets = samples.map((sample) => normalizedDifference(sample.pitch, anchor));
  if (Math.max(...offsets) - Math.min(...offsets) > STABLE_RANGE) return null;

  return normalizedDifference(anchor + median(offsets), 0);
}
