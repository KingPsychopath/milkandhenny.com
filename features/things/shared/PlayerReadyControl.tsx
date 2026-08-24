interface PlayerReadyControlProps {
  ready: boolean;
  onChange: (ready: boolean) => void;
  tone?: "light" | "dark";
}

export function PlayerReadyControl({ ready, onChange, tone = "dark" }: PlayerReadyControlProps) {
  const light = tone === "light";
  const surface = light
    ? "border-black/15 bg-white/30 text-black"
    : "border-white/15 bg-white/[0.05] text-white";
  const muted = light ? "text-black/50" : "text-white/50";
  const icon = ready
    ? light
      ? "border-black bg-black text-white"
      : "border-[var(--things-amber)] bg-[var(--things-amber)] text-black"
    : light
      ? "border-black/25 text-black/35"
      : "border-white/25 text-white/40";
  const action = ready
    ? light
      ? "text-black/55"
      : "text-white/55"
    : light
      ? "border-black bg-black text-white"
      : "border-[var(--things-amber)] bg-[var(--things-amber)] text-black";

  return (
    <section
      aria-label="Your ready status"
      className={`mt-5 w-full rounded-3xl border p-4 text-left ${surface}`}
    >
      <div className="flex items-center gap-3" aria-live="polite" aria-atomic="true">
        <span
          aria-hidden="true"
          className={`grid size-9 shrink-0 place-items-center rounded-full border ${icon}`}
        >
          {ready ? (
            <svg viewBox="0 0 20 20" className="size-5 fill-none stroke-current" strokeWidth="2">
              <path d="m5 10.5 3.1 3.1L15.5 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <span className="size-2 rounded-full bg-current" />
          )}
        </span>
        <span className="min-w-0">
          <strong className="block font-mono text-sm">
            {ready ? "You’re ready" : "You’re not ready"}
          </strong>
          <span className={`mt-0.5 block font-mono text-xs leading-relaxed ${muted}`}>
            {ready
              ? "You’re all set — wait for the host to start."
              : "Tap “I’m ready” when you’re back."}
          </span>
        </span>
      </div>
      <button
        type="button"
        onClick={() => onChange(!ready)}
        className={
          ready
            ? `ml-11 mt-1 min-h-11 px-2 font-mono text-xs ${action}`
            : `mt-4 min-h-11 w-full rounded-full border px-5 font-mono text-xs font-semibold ${action}`
        }
      >
        {ready ? "step away for now" : "I’m ready"}
      </button>
    </section>
  );
}
