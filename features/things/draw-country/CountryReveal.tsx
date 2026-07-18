import { useId, useState } from "react";
import { closestOnBorder, pointInShape, ringLength } from "./geometry";
import type { CountryEvaluation } from "./scoring";
import type { CountryDrawing, DrawPoint } from "./types";

const SCALE = 820;
const OFFSET = 90;
const MAX_GUIDES = 40;

type ScoreMetricKey = "average" | "outside" | "inside" | "missed" | "shape" | "strokes" | "islands";

const SCORE_EXPLANATIONS: Record<ScoreMetricKey, string> = {
  average: "Combined weighted error across all the scoring checks. Lower is better.",
  outside: "Weighted distance from parts of your outline outside the reference. Lower is better.",
  inside:
    "Weighted distance from parts of your outline that cut inside the reference. Lower is better.",
  missed: "How much of the reference border your outline did not reach. Lower is better.",
  shape: "How differently your overall silhouette overlaps the reference. Lower is better.",
  strokes:
    "Penalty for crossings, very thin marks, or excessive tracing. 0% means no stroke penalty.",
  islands:
    "Difference in the number and relative sizes of separate land masses. 0% means no island penalty.",
};

function pathFor(ring: DrawPoint[], scale = 820, offset = 90) {
  if (!ring.length) return "";
  return `${ring.map((point, index) => `${index ? "L" : "M"}${offset + point.x * scale} ${offset + point.y * scale}`).join(" ")} Z`;
}

function guidePoints(drawing: CountryDrawing) {
  const rings = drawing.filter((ring) => ring.length);
  const pointCount = rings.reduce((total, ring) => total + ring.length, 0);
  const budget = Math.min(MAX_GUIDES, pointCount);
  if (!budget) return [];

  const lengths = rings.map(ringLength);
  const totalLength = lengths.reduce((total, length) => total + length, 0);
  const minimum = budget >= rings.length ? 1 : 0;
  const remaining = budget - minimum * rings.length;
  const allocations = lengths.map((length, index) => {
    const exact = totalLength ? (length / totalLength) * remaining : 0;
    return { index, count: minimum + Math.floor(exact), remainder: exact % 1 };
  });
  let assigned = allocations.reduce((total, allocation) => total + allocation.count, 0);
  for (const allocation of allocations.toSorted((a, b) => b.remainder - a.remainder)) {
    if (assigned >= budget) break;
    allocations[allocation.index].count += 1;
    assigned += 1;
  }

  return rings.flatMap((ring, index) => {
    const count = allocations[index].count;
    return Array.from(
      { length: count },
      (_, pointIndex) => ring[Math.floor((pointIndex / count) * ring.length)],
    );
  });
}

function guideLines(drawing: CountryDrawing, reference: CountryDrawing) {
  return guidePoints(drawing).map((point) => ({
    point,
    target: closestOnBorder(point, reference).point,
    position: pointInShape(point, reference) ? "inside" : "outside",
  }));
}

export function CountryReveal({ evaluation }: { evaluation: CountryEvaluation }) {
  const guides = guideLines(evaluation.drawing, evaluation.reference);
  return (
    <svg
      viewBox="0 0 1000 1000"
      role="img"
      aria-label={`Reference country border compared with your aligned drawing. Red lines measure gaps from your points outside the reference; blue lines measure gaps from your points inside it. Score ${evaluation.score} out of 100.`}
      className="block aspect-square w-full rounded-[1.75rem] border border-black/15 bg-white/45"
    >
      <title>Reference country border and your aligned drawing</title>
      {evaluation.reference.map((ring, index) => (
        <path
          key={`reference-${index}`}
          d={pathFor(ring)}
          pathLength="1"
          fill="none"
          className="country-reveal-reference"
          strokeWidth="4"
          strokeLinejoin="round"
          style={{ animationDelay: `${Math.min(index * 30, 240)}ms` }}
        />
      ))}
      {guides.map(({ point, target, position }, index) => (
        <line
          key={index}
          x1={OFFSET + point.x * SCALE}
          y1={OFFSET + point.y * SCALE}
          x2={OFFSET + target.x * SCALE}
          y2={OFFSET + target.y * SCALE}
          pathLength="1"
          className={`country-reveal-guide country-reveal-guide--${position}`}
          strokeWidth="2"
          style={{ animationDelay: `${760 + index * 22}ms` }}
        />
      ))}
      {evaluation.drawing.map((ring, index) => (
        <path
          key={`drawing-${index}`}
          d={pathFor(ring)}
          pathLength="1"
          fill="none"
          className="country-reveal-drawing"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ animationDelay: `${280 + Math.min(index * 45, 260)}ms` }}
        />
      ))}
      {guides.map(({ point }, index) => (
        <circle
          key={`point-${index}`}
          cx={OFFSET + point.x * SCALE}
          cy={OFFSET + point.y * SCALE}
          r="4"
          className="country-reveal-point"
          style={{ animationDelay: `${880 + index * 22}ms` }}
        />
      ))}
    </svg>
  );
}

export function CountryRevealLegend() {
  return (
    <div className="mt-4">
      <ul
        className="flex flex-wrap gap-x-5 gap-y-3 font-mono text-micro text-black/50"
        aria-label="Comparison key"
      >
        <li className="flex items-center gap-2">
          <span className="country-legend-reference" aria-hidden="true" />
          reference
        </li>
        <li className="flex items-center gap-2">
          <span className="country-legend-point" aria-hidden="true" />
          your points
        </li>
        <li className="flex items-center gap-2">
          <span className="country-legend-outside" aria-hidden="true" />
          outside
        </li>
        <li className="flex items-center gap-2">
          <span className="country-legend-inside" aria-hidden="true" />
          inside
        </li>
      </ul>
    </div>
  );
}

export function CountryScoreDetails({ evaluation }: { evaluation: CountryEvaluation }) {
  const explanationId = useId();
  const [activeMetric, setActiveMetric] = useState<ScoreMetricKey | null>(null);
  const metrics: Array<{
    key: ScoreMetricKey;
    label: string;
    value: number;
    accessibleLabel: string;
  }> = [
    {
      key: "average",
      label: "average",
      value: evaluation.deviation,
      accessibleLabel: "Average weighted deviation",
    },
    {
      key: "outside",
      label: "outside",
      value: evaluation.outsideDeviation,
      accessibleLabel: "Outside deviation contribution",
    },
    {
      key: "inside",
      label: "inside",
      value: evaluation.insideDeviation,
      accessibleLabel: "Inside deviation contribution",
    },
    {
      key: "missed",
      label: "missed",
      value: evaluation.coverageDeviation,
      accessibleLabel: "Missed border contribution",
    },
    {
      key: "shape",
      label: "shape",
      value: evaluation.silhouetteDeviation,
      accessibleLabel: "Shape deviation contribution",
    },
    {
      key: "strokes",
      label: "strokes",
      value: evaluation.strokeDeviation,
      accessibleLabel: "Stroke quality penalty",
    },
  ];
  if (evaluation.reference.length > 1)
    metrics.push({
      key: "islands",
      label: "islands",
      value: evaluation.islandDeviation,
      accessibleLabel: "Island balance penalty",
    });

  return (
    <div className="mt-4">
      <dl className="flex flex-wrap gap-x-2 gap-y-1 font-mono text-micro text-black/45">
        {metrics.map((metric) => {
          const isActive = activeMetric === metric.key;
          return (
            <div key={metric.key}>
              <dt className="sr-only">{metric.accessibleLabel}</dt>
              <dd>
                <button
                  type="button"
                  aria-expanded={isActive}
                  aria-controls={isActive ? explanationId : undefined}
                  onClick={() => setActiveMetric(isActive ? null : metric.key)}
                  className={`-my-2 inline-flex min-h-11 items-center rounded px-1 underline decoration-black/25 decoration-dotted underline-offset-4 transition-colors hover:text-black/70 ${isActive ? "bg-black/[0.04] text-black/70" : ""}`}
                >
                  {metric.label} {metric.value}%
                </button>
              </dd>
            </div>
          );
        })}
      </dl>
      {activeMetric ? (
        <p
          id={explanationId}
          className="mt-1 max-w-xl font-mono text-micro leading-relaxed text-black/45"
        >
          {SCORE_EXPLANATIONS[activeMetric]}
        </p>
      ) : null}
    </div>
  );
}
