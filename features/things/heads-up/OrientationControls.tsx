interface OrientationControlsProps {
  locked: boolean;
  motionUnavailable: boolean;
  onStart: () => void;
  onToggle: () => void;
}

export function OrientationControls({
  locked,
  motionUnavailable,
  onStart,
  onToggle,
}: OrientationControlsProps) {
  return (
    <div className="mx-auto mt-6 max-w-lg">
      <div className="mb-3 flex items-center justify-between gap-4">
        <p id="position-lock-note" className="font-mono text-micro leading-relaxed text-white/45">
          {locked ? "pauses if the phone rotates" : "adapts when the phone rotates"}
        </p>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={locked}
          aria-describedby="position-lock-note"
          className={`min-h-11 shrink-0 rounded-full border px-4 font-mono text-xs transition-colors ${
            locked ? "border-white/55 bg-white/12 text-white" : "border-white/15 text-white/55"
          }`}
        >
          orientation · {locked ? "locked" : "auto"} {locked ? "▣" : "↻"}
        </button>
      </div>
      <button
        type="button"
        onClick={onStart}
        className="min-h-16 w-full rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-bold text-black shadow-2xl transition-transform hover:scale-[1.01]"
      >
        start 60-second round
      </button>
      <p className="mt-3 text-center font-mono text-micro text-white/45">
        {motionUnavailable
          ? "motion unavailable — use the on-screen buttons"
          : `portrait + landscape · ${locked ? "locks when the round starts" : "auto-calibrates"}`}
      </p>
    </div>
  );
}
