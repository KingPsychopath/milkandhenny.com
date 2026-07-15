import { TextMorph } from "torph/react";
import type { MotionPauseReason } from "../shared/useTiltControl";

type Decision = "correct" | "pass";

interface RoundPlayAreaProps {
  card: string;
  feedback: Decision | null;
  controlsLocked?: boolean;
  pauseReason: MotionPauseReason | "interrupted" | "remote" | null;
  onDecision: (decision: Decision) => void;
  onResume: () => void;
  onEnd: () => void;
}

const SNAP_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

function cardSizeClass(card: string) {
  if (card.length > 45) return "text-2xl sm:text-4xl";
  if (card.length > 30) return "text-3xl sm:text-5xl";
  if (card.length > 20) return "text-4xl sm:text-6xl";
  return "text-5xl sm:text-7xl";
}

export function RoundPlayArea({
  card,
  controlsLocked = false,
  feedback,
  pauseReason,
  onDecision,
  onResume,
  onEnd,
}: RoundPlayAreaProps) {
  const paused = pauseReason !== null;

  return (
    <>
      <main
        id="main"
        className="relative flex min-w-0 flex-1 flex-col items-center justify-center overflow-hidden px-6 text-center text-black"
      >
        {pauseReason ? (
          <div role="alert" aria-live="assertive" className="max-w-sm">
            <p className="font-mono text-micro uppercase tracking-[0.2em] text-black/50">
              round paused · timer stopped
            </p>
            <h1 className="mt-4 font-serif text-5xl font-semibold leading-none">
              {pauseReason === "remote"
                ? "Judge paused the round."
                : pauseReason === "wrong-orientation"
                ? "Turn the phone back."
                : pauseReason === "settling"
                  ? "Hold steady…"
                  : "Welcome back."}
            </h1>
            <p className="mt-5 font-serif text-lg text-black/65">
              {pauseReason === "remote"
                ? "Resume here or from the judge’s phone when everyone is ready."
                : pauseReason === "wrong-orientation"
                ? "This round is locked to the position you started in."
                : pauseReason === "settling"
                  ? "Recalibrating so your next movement is deliberate."
                  : "The round stayed paused while the app was away."}
            </p>
            {pauseReason === "interrupted" || pauseReason === "remote" ? (
              <button
                type="button"
                onClick={onResume}
                className="mt-7 min-h-12 rounded-full bg-black px-6 font-mono text-sm font-semibold text-white"
              >
                resume round
              </button>
            ) : null}
            <button type="button" onClick={onEnd} className="mt-2 min-h-11 px-4 font-mono text-xs text-black/55 underline underline-offset-4">
              end round
            </button>
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
              className={`things-game-card w-full max-w-3xl text-center font-serif font-semibold leading-[0.95] tracking-tight ${cardSizeClass(card)}`}
            >
              {card}
            </TextMorph>
            <p className="mt-8 font-mono text-micro uppercase tracking-[0.18em] text-black/50">
              {controlsLocked ? "judge controls this round" : "down = correct · up = pass"}
            </p>
          </>
        )}
      </main>

      <footer className="grid grid-cols-2 gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => onDecision("pass")}
          disabled={paused || controlsLocked}
          className="min-h-14 rounded-full border border-black/20 bg-black/5 font-mono text-sm font-semibold text-black disabled:opacity-35"
        >
          ↑ pass
        </button>
        <button
          type="button"
          onClick={() => onDecision("correct")}
          disabled={paused || controlsLocked}
          className="min-h-14 rounded-full bg-black font-mono text-sm font-semibold text-white disabled:opacity-35"
        >
          correct ↓
        </button>
      </footer>
    </>
  );
}
