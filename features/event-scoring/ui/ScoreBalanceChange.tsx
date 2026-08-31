import { useEffect, useMemo, useRef, useState } from "react";

export type ScoreBalanceNotice = {
  id: string;
  kind: "positive" | "negative" | "held" | "reversal" | string;
  points: number;
};

export function confirmedScoreDelta(notices: ScoreBalanceNotice[]) {
  return notices.reduce((total, notice) => {
    if (notice.kind === "held") return total;
    return total + notice.points;
  }, 0);
}

function pendingScoreDelta(notices: ScoreBalanceNotice[]) {
  return notices.reduce((total, notice) => total + (notice.kind === "held" ? notice.points : 0), 0);
}

function signedPoints(points: number) {
  return `${points > 0 ? "+" : ""}${points}`;
}

export function ScoreBalanceChange({
  notices,
  balance,
}: {
  notices: ScoreBalanceNotice[];
  balance?: number;
}) {
  const delta = useMemo(() => confirmedScoreDelta(notices), [notices]);
  const pending = useMemo(() => pendingScoreDelta(notices), [notices]);
  const previousBalance = balance === undefined ? undefined : balance - delta;
  const [displayBalance, setDisplayBalance] = useState(previousBalance ?? balance ?? 0);
  const [settled, setSettled] = useState(false);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    if (balance === undefined || previousBalance === undefined) return;
    setDisplayBalance(previousBalance);
    setSettled(false);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || previousBalance === balance) {
      setDisplayBalance(balance);
      setSettled(true);
      return;
    }

    const startedAt = performance.now();
    const duration = 950;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 4;
      setDisplayBalance(Math.round(previousBalance + (balance - previousBalance) * eased));
      if (progress < 1) animationRef.current = requestAnimationFrame(tick);
      else {
        setDisplayBalance(balance);
        setSettled(true);
      }
    };
    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    };
  }, [balance, previousBalance]);

  const tone =
    delta > 0
      ? "var(--status-positive)"
      : delta < 0
        ? "var(--status-danger)"
        : "var(--status-attention)";
  const label = delta === 0 ? "points pending" : "score updated";

  return (
    <aside
      aria-label="Score update"
      className="score-celebration fixed inset-x-3 bottom-3 z-40 mx-auto max-w-sm overflow-hidden rounded-[1.75rem] border bg-background/95 px-5 py-4 shadow-2xl backdrop-blur-xl sm:bottom-5"
      style={{ borderColor: `color-mix(in oklch, ${tone} 42%, var(--stone-200))` }}
    >
      <div className="flex items-center justify-between gap-4 font-mono text-micro uppercase tracking-widest">
        <span className="flex items-center gap-2" style={{ color: tone }}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
          {label}
        </span>
        <span className="theme-muted">event points</span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-5">
        <div className="min-w-0">
          {balance !== undefined ? (
            <div className="flex items-baseline gap-2">
              <strong
                aria-hidden="true"
                className={`score-balance-total font-serif text-5xl font-normal leading-none tabular-nums ${settled ? "score-balance-total--settled" : ""}`}
              >
                {displayBalance}
              </strong>
              <span className="font-mono text-xs theme-muted">points</span>
            </div>
          ) : (
            <strong className="font-serif text-4xl font-normal tabular-nums">
              {delta !== 0 ? signedPoints(delta) : `${Math.abs(pending)} pending`}
            </strong>
          )}
        </div>

        {delta !== 0 ? (
          <span
            aria-hidden="true"
            className="score-balance-delta shrink-0 rounded-full border px-3 py-1.5 font-mono text-sm tabular-nums"
            style={{ borderColor: `color-mix(in oklch, ${tone} 48%, transparent)`, color: tone }}
          >
            {signedPoints(delta)}
          </span>
        ) : pending !== 0 && balance !== undefined ? (
          <span className="shrink-0 font-mono text-xs text-[var(--status-attention)]">
            {Math.abs(pending)} pending
          </span>
        ) : null}
      </div>

      <p className="sr-only" aria-live="polite">
        {balance !== undefined
          ? delta === 0
            ? `${Math.abs(pending)} points pending. Your confirmed total is ${balance} points.`
            : `${Math.abs(delta)} points ${delta > 0 ? "added" : "removed"}. Your new total is ${balance} points.`
          : delta === 0
            ? `${Math.abs(pending)} points pending.`
            : `${Math.abs(delta)} points ${delta > 0 ? "added" : "removed"}.`}
      </p>
    </aside>
  );
}
