import { useEffect, useState, type CSSProperties } from "react";
import type { HeatBand } from "./hot-and-cold-rules";

function heatProgress(rank: number | null) {
  if (rank === 0) return 1;
  if (rank === null) return 0.06;
  const progress = 1 - Math.log10(rank + 1) / Math.log10(50_001);
  return Math.min(0.96, Math.max(0.06, progress));
}

export function HeatGauge({
  band,
  rank,
  streak = 0,
  solved = false,
}: {
  band: HeatBand;
  rank: number | null;
  streak?: number;
  solved?: boolean;
}) {
  const progress = heatProgress(rank);
  const streakLevel =
    streak >= 6 ? "blazing" : streak >= 4 ? "lit" : streak >= 3 ? "glowing" : undefined;
  const [visibleStreakLevel, setVisibleStreakLevel] = useState(streakLevel);
  const [cooling, setCooling] = useState(false);
  useEffect(() => {
    if (streakLevel) {
      setVisibleStreakLevel(streakLevel);
      setCooling(false);
      return;
    }
    if (!visibleStreakLevel) return;
    setCooling(true);
    const finish = window.setTimeout(() => {
      setVisibleStreakLevel(undefined);
      setCooling(false);
    }, 650);
    return () => window.clearTimeout(finish);
  }, [streakLevel, visibleStreakLevel]);
  const style = {
    "--heat-offset": 100 - progress * 100,
    "--heat-scale": progress,
    "--heat-amber-mix": `${Math.round(Math.min(1, progress / 0.72) * 100)}%`,
    "--heat-red-mix": `${Math.round(Math.max(0, (progress - 0.72) / 0.28) * 100)}%`,
  } as CSSProperties;

  return (
    <div
      className="heat-source-flame"
      data-band={band}
      data-streak={visibleStreakLevel}
      data-cooling={cooling || undefined}
      data-solved={solved || undefined}
      style={style}
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48">
        <circle className="heat-gauge-streak-aura" cx="24" cy="24" r="23" pathLength="100" />
        <circle className="heat-gauge-streak" cx="24" cy="24" r="23" pathLength="100" />
        <circle className="heat-gauge-track" cx="24" cy="24" r="21" pathLength="100" />
        <circle className="heat-gauge-progress" cx="24" cy="24" r="21" pathLength="100" />
      </svg>
      <span />
    </div>
  );
}
