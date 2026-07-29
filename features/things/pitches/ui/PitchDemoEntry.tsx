import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

const CONFIRMATION_MS = 3_500;
const TICK_MS = 100;

export function PitchDemoEntry({ className = "" }: { className?: string }) {
  const navigate = useNavigate();
  const [startedAt, setStartedAt] = useState<number>();
  const [elapsed, setElapsed] = useState(0);
  const navigating = useRef(false);

  useEffect(() => {
    if (startedAt === undefined) return;
    const update = () => {
      const next = Math.min(CONFIRMATION_MS, performance.now() - startedAt);
      setElapsed(next);
      if (next < CONFIRMATION_MS || navigating.current) return;
      navigating.current = true;
      void navigate({ to: "/things/pitches/demo" }).catch(() => {
        navigating.current = false;
        setStartedAt(undefined);
        setElapsed(0);
      });
    };
    update();
    const timer = window.setInterval(update, TICK_MS);
    return () => window.clearInterval(timer);
  }, [navigate, startedAt]);

  const confirming = startedAt !== undefined;
  const remaining = Math.max(1, Math.ceil((CONFIRMATION_MS - elapsed) / 1_000));
  const progress = confirming ? Math.min(100, (elapsed / CONFIRMATION_MS) * 100) : 0;

  return (
    <div className={className}>
      <button
        type="button"
        aria-pressed={confirming}
        onClick={() => {
          if (confirming) {
            setStartedAt(undefined);
            setElapsed(0);
            return;
          }
          navigating.current = false;
          setElapsed(0);
          setStartedAt(performance.now());
        }}
        className="group relative min-h-12 w-full overflow-hidden border theme-border-strong bg-background px-5 font-mono text-xs text-foreground hover:opacity-80"
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 bg-[var(--selection-bg)] transition-[width] duration-100 ease-linear motion-reduce:transition-none"
          style={{ width: `${progress}%` }}
        />
        <span className="relative">
          {confirming ? `opening in ${remaining} · click to cancel` : "look around first"}
        </span>
      </button>
      <p className="mt-2 font-mono text-micro leading-relaxed theme-muted" aria-live="polite">
        {confirming
          ? "This is a private rehearsal: nothing will be saved, uploaded, emailed or published."
          : "Explore the whole studio without giving us any details. Demo work disappears when you leave."}
      </p>
    </div>
  );
}
