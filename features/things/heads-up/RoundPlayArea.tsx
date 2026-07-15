import { TextMorph } from "torph/react";
import type { MotionPauseReason } from "./useTiltControl";

type Decision = "correct" | "pass";

interface RoundPlayAreaProps {
  card: string;
  feedback: Decision | null;
  pauseReason: MotionPauseReason | "interrupted" | null;
  onDecision: (decision: Decision) => void;
  onResume: () => void;
}

const SNAP_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export function RoundPlayArea({
  card,
  feedback,
  pauseReason,
  onDecision,
  onResume,
}: RoundPlayAreaProps) {
  const paused = pauseReason !== null;

  return (
    <>
      <main
        id="main"
        className="relative flex flex-1 flex-col items-center justify-center px-6 text-center text-black"
      >
        {pauseReason ? (
          <div role="alert" aria-live="assertive" className="max-w-sm">
            <p className="font-mono text-micro uppercase tracking-[0.2em] text-black/50">
              round paused · timer stopped
            </p>
            <h1 className="mt-4 font-serif text-5xl font-semibold leading-none">
              {pauseReason === "wrong-orientation"
                ? "Turn the phone back."
                : pauseReason === "settling"
                  ? "Hold steady…"
                  : "Welcome back."}
            </h1>
            <p className="mt-5 font-serif text-lg text-black/65">
              {pauseReason === "wrong-orientation"
                ? "This round is locked to the position you started in."
                : pauseReason === "settling"
                  ? "Recalibrating so your next movement is deliberate."
                  : "The round stayed paused while the app was away."}
            </p>
            {pauseReason === "interrupted" ? (
              <button
                type="button"
                onClick={onResume}
                className="mt-7 min-h-12 rounded-full bg-black px-6 font-mono text-sm font-semibold text-white"
              >
                resume round
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div
              aria-live="polite"
              className="absolute top-5 font-mono text-sm font-semibold uppercase tracking-[0.2em]"
            >
              {feedback === "correct" ? "✓ correct" : feedback === "pass" ? "↑ pass" : ""}
            </div>
            <TextMorph
              as="h1"
              duration={320}
              ease={SNAP_EASE}
              className="max-w-3xl font-serif text-5xl font-semibold leading-[0.95] tracking-tight sm:text-7xl"
            >
              {card}
            </TextMorph>
            <p className="mt-8 font-mono text-micro uppercase tracking-[0.18em] text-black/50">
              down = correct · up = pass
            </p>
          </>
        )}
      </main>

      <footer className="grid grid-cols-2 gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => onDecision("pass")}
          disabled={paused}
          className="min-h-14 rounded-full border border-black/20 bg-black/5 font-mono text-sm font-semibold text-black disabled:opacity-35"
        >
          ↑ pass
        </button>
        <button
          type="button"
          onClick={() => onDecision("correct")}
          disabled={paused}
          className="min-h-14 rounded-full bg-black font-mono text-sm font-semibold text-white disabled:opacity-35"
        >
          correct ↓
        </button>
      </footer>
    </>
  );
}
