interface PartyRoundCooldownProps {
  progress: number | null;
  seconds: number | null;
  finalRound: boolean;
  onTogglePause?: () => void;
}

export function PartyRoundCooldown({
  progress,
  seconds,
  finalRound,
  onTogglePause,
}: PartyRoundCooldownProps) {
  const paused = progress === null;
  const destination = finalRound ? "final scores" : "next word";
  return (
    <div className="mt-7">
      <div
        role="progressbar"
        aria-label={`Time until ${destination}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={paused ? undefined : Math.round(progress * 100)}
        aria-valuetext={paused ? "Paused" : `${seconds ?? 0} seconds remaining`}
        className="h-2 overflow-hidden rounded-full bg-white/10"
      >
        <div
          className="h-full origin-left rounded-full bg-[var(--things-amber)] transition-transform duration-100 ease-linear motion-reduce:transition-none"
          style={{ transform: `scaleX(${progress ?? 0})` }}
        />
      </div>
      <div className="mt-3 flex min-h-11 items-center justify-between gap-3 font-mono text-xs text-white/50">
        <span aria-live="polite">
          {paused ? "next round paused" : `${destination} in ${seconds ?? 0}s`}
        </span>
        {onTogglePause ? (
          <button
            type="button"
            onClick={onTogglePause}
            className="min-h-11 shrink-0 rounded-full border border-white/20 px-4 text-white focus-visible:ring-2 focus-visible:ring-white/75"
          >
            {paused ? "resume countdown" : `pause ${destination}`}
          </button>
        ) : null}
      </div>
    </div>
  );
}
