import { useId, useState } from "react";
import { closestOnBorder, ringLength } from "./geometry";
import { countryScoreBreakdown, type CountryEvaluation, type CountryFeedbackKey } from "./scoring";
import type { CountryDrawing, DrawPoint } from "./types";

const SCALE = 820;
const OFFSET = 90;
const MAX_GUIDES = 40;
const MAX_MISSED_GUIDES = 24;

const SCORE_EXPLANATIONS: Record<CountryFeedbackKey, string> = {
  outline: "Amber guides show where your line moved away from the real border.",
  coverage: "Dashed guides point to coast you shortened, skipped, or placed elsewhere.",
  shape: "The fills compare the overall silhouettes, after position and size are aligned.",
  strokes: "A clean, single outline scores best. Extra crossings and repeated tracing lose points.",
  islands: "Separate land masses are compared by their relative sizes, not tiny island detail.",
};

const SCORE_COACHING: Record<CountryFeedbackKey, { strong: string; improve: string }> = {
  outline: {
    strong: "Your line stayed close to the real border.",
    improve: "Follow the big bends first; small coastline detail matters less.",
  },
  coverage: {
    strong: "You remembered nearly all of the coastline.",
    improve: "Keep the outline moving around the whole country before adding detail.",
  },
  shape: {
    strong: "The country reads clearly from its silhouette.",
    improve: "Start with the country's widest and tallest points to lock in its proportions.",
  },
  strokes: {
    strong: "That was a clean, confident outline.",
    improve: "Use one continuous stroke for the mainland and lift only for islands.",
  },
  islands: {
    strong: "The main land masses are in good balance.",
    improve: "Draw the largest islands separately; tiny ones are deliberately forgiving.",
  },
};

function pathFor(ring: DrawPoint[], scale = 820, offset = 90) {
  if (!ring.length) return "";
  return `${ring.map((point, index) => `${index ? "L" : "M"}${offset + point.x * scale} ${offset + point.y * scale}`).join(" ")} Z`;
}

function guidePoints(drawing: CountryDrawing, maximum = MAX_GUIDES) {
  const rings = drawing.filter((ring) => ring.length);
  const pointCount = rings.reduce((total, ring) => total + ring.length, 0);
  const budget = Math.min(maximum, pointCount);
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
  }));
}

function missedGuideLines(reference: CountryDrawing, drawing: CountryDrawing) {
  return guidePoints(reference, MAX_MISSED_GUIDES).map((point) => ({
    point,
    target: closestOnBorder(point, drawing).point,
  }));
}

export function CountryReveal({
  evaluation,
  focus,
  id,
}: {
  evaluation: CountryEvaluation;
  focus: CountryFeedbackKey | null;
  id: string;
}) {
  const guides = focus === "outline" ? guideLines(evaluation.drawing, evaluation.reference) : [];
  const missedGuides =
    focus === "coverage" ? missedGuideLines(evaluation.reference, evaluation.drawing) : [];
  return (
    <svg
      id={id}
      viewBox="0 0 1000 1000"
      role="img"
      data-focus={focus ?? "all"}
      aria-label={`Real country border compared with your drawing after position and size are aligned. Score ${evaluation.score} out of 100.${focus ? ` ${SCORE_EXPLANATIONS[focus]}` : ""}`}
      className="country-reveal-board block aspect-square w-full rounded-[1.75rem] border border-black/15 bg-white/45"
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
      <g aria-hidden="true">
        {evaluation.reference.map((ring, index) => (
          <path
            key={`shape-reference-${index}`}
            d={pathFor(ring)}
            className="country-reveal-shape country-reveal-shape--reference"
          />
        ))}
        {evaluation.drawing.map((ring, index) => (
          <path
            key={`shape-drawing-${index}`}
            d={pathFor(ring)}
            className="country-reveal-shape country-reveal-shape--drawing"
          />
        ))}
      </g>
      {guides.map(({ point, target }, index) => (
        <line
          key={index}
          x1={OFFSET + point.x * SCALE}
          y1={OFFSET + point.y * SCALE}
          x2={OFFSET + target.x * SCALE}
          y2={OFFSET + target.y * SCALE}
          pathLength="1"
          className="country-reveal-guide country-reveal-guide--gap"
          strokeWidth="2"
          style={{ animationDelay: `${760 + index * 22}ms` }}
        />
      ))}
      {missedGuides.map(({ point, target }, index) => (
        <line
          key={`missed-${index}`}
          x1={OFFSET + point.x * SCALE}
          y1={OFFSET + point.y * SCALE}
          x2={OFFSET + target.x * SCALE}
          y2={OFFSET + target.y * SCALE}
          pathLength="1"
          className="country-reveal-guide country-reveal-guide--missed"
          strokeWidth="2"
          style={{ animationDelay: `${index * 16}ms` }}
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

export function CountryRevealLegend({ focus }: { focus: CountryFeedbackKey | null }) {
  return (
    <div className="mt-4">
      <ul
        className="flex flex-wrap gap-x-5 gap-y-3 font-mono text-micro text-black/50"
        aria-label="Comparison key"
      >
        <li className="flex items-center gap-2">
          <span className="country-legend-reference" aria-hidden="true" />
          real border
        </li>
        <li className="flex items-center gap-2">
          <span className="country-legend-drawing" aria-hidden="true" />
          your drawing
        </li>
        {focus === "outline" || focus === "coverage" ? (
          <li className="flex items-center gap-2">
            <span className="country-legend-gap" aria-hidden="true" />
            {focus === "outline" ? "border gap" : "coast missed"}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

export function CountryScoreDetails({
  evaluation,
  activeMetric,
  onMetricChange,
  revealId,
  explanationId,
}: {
  evaluation: CountryEvaluation;
  activeMetric: CountryFeedbackKey | null;
  onMetricChange: (metric: CountryFeedbackKey | null) => void;
  revealId: string;
  explanationId: string;
}) {
  const metrics = countryScoreBreakdown(evaluation, evaluation.reference.length > 1);
  const strongest = metrics.toSorted((first, second) => second.score - first.score)[0];
  const next = metrics.toSorted((first, second) => first.score - second.score)[0];
  const hasDrawing = evaluation.drawing.length > 0;

  return (
    <div className="mt-5">
      <div className="grid gap-2 sm:grid-cols-2">
        <p className="border-t border-black/10 pt-3 font-serif text-sm leading-relaxed text-black/65">
          <span className="block font-mono text-micro uppercase tracking-[0.14em] text-black/40">
            strongest
          </span>
          {hasDrawing ? SCORE_COACHING[strongest.key].strong : "No outline was locked in."}
        </p>
        <p className="border-t border-black/10 pt-3 font-serif text-sm leading-relaxed text-black/65">
          <span className="block font-mono text-micro uppercase tracking-[0.14em] text-black/40">
            next time
          </span>
          {!hasDrawing
            ? "Draw one complete loop, then tap done before time runs out."
            : next.score >= 95
              ? "Nothing obvious to fix — try less time or a harder country."
              : SCORE_COACHING[next.key].improve}
        </p>
      </div>
      <p className="mt-5 font-mono text-micro uppercase tracking-[0.14em] text-black/40">
        tap a score to inspect the map
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {metrics.map((metric) => {
          const isActive = activeMetric === metric.key;
          return (
            <div key={metric.key} className="min-w-0">
              <dt className="sr-only">{metric.label}</dt>
              <dd>
                <button
                  type="button"
                  aria-pressed={isActive}
                  aria-controls={`${revealId}${isActive ? ` ${explanationId}` : ""}`}
                  onClick={() => onMetricChange(isActive ? null : metric.key)}
                  className={`flex min-h-16 w-full flex-col justify-center rounded-2xl border px-3 text-left font-mono transition-opacity hover:opacity-75 ${isActive ? "border-black/35 bg-white/55" : "border-black/10 bg-white/20"}`}
                >
                  <span className="text-lg font-semibold text-black">{metric.score}</span>
                  <span className="mt-0.5 truncate text-micro text-black/45">{metric.label}</span>
                </button>
              </dd>
            </div>
          );
        })}
      </dl>
      {activeMetric ? (
        <p
          id={explanationId}
          aria-live="polite"
          className="mt-3 max-w-xl font-mono text-micro leading-relaxed text-black/50"
        >
          {SCORE_EXPLANATIONS[activeMetric]}
        </p>
      ) : (
        <p className="mt-3 max-w-xl font-mono text-micro leading-relaxed text-black/45">
          We align position and size, then compare the border, missing coast, overall shape, and
          stroke quality. Higher is better.
        </p>
      )}
    </div>
  );
}

export function CountryRevealAnalysis({ evaluation }: { evaluation: CountryEvaluation }) {
  const revealId = useId();
  const explanationId = useId();
  const [activeMetric, setActiveMetric] = useState<CountryFeedbackKey | null>(null);

  return (
    <>
      <CountryReveal evaluation={evaluation} focus={activeMetric} id={revealId} />
      <CountryScoreDetails
        evaluation={evaluation}
        activeMetric={activeMetric}
        onMetricChange={setActiveMetric}
        revealId={revealId}
        explanationId={explanationId}
      />
      <CountryRevealLegend focus={activeMetric} />
    </>
  );
}
