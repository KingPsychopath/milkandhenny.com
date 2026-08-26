import type { CSSProperties } from "react";
import type { HeatBand } from "./hot-and-cold-rules";

function heatProgress(rank: number | null) {
  if (rank === 0) return 1;
  if (rank === null) return 0.06;
  const progress = 1 - Math.log10(rank + 1) / Math.log10(50_001);
  return Math.min(0.96, Math.max(0.06, progress));
}

export function HeatGauge({ band, rank }: { band: HeatBand; rank: number | null }) {
  const progress = heatProgress(rank);
  const style = {
    "--heat-offset": 100 - progress * 100,
    "--heat-scale": progress,
    "--heat-mix": `${Math.round(progress * 100)}%`,
  } as CSSProperties;

  return (
    <div className="heat-source-flame" data-band={band} style={style} aria-hidden="true">
      <svg viewBox="0 0 48 48">
        <circle className="heat-gauge-track" cx="24" cy="24" r="21" pathLength="100" />
        <circle className="heat-gauge-progress" cx="24" cy="24" r="21" pathLength="100" />
      </svg>
      <span />
    </div>
  );
}
