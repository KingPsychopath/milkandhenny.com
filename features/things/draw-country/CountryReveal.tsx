import type { CountryEvaluation } from "./scoring";
import type { CountryDrawing, DrawPoint } from "./types";
import { closestOnBorder, pointInShape, ringLength } from "./geometry";

const SCALE = 820;
const OFFSET = 90;
const VISUAL_MATCH_DISTANCE = 8 / SCALE;
const MAX_DISTANCE_GUIDES = 16;

function pathFor(ring: DrawPoint[], scale = 820, offset = 90) {
  if (!ring.length) return "";
  return `${ring.map((point, index) => `${index ? "L" : "M"}${offset + point.x * scale} ${offset + point.y * scale}`).join(" ")} Z`;
}

function segmentPath(start: DrawPoint, end: DrawPoint) {
  return `M${OFFSET + start.x * SCALE} ${OFFSET + start.y * SCALE} L${OFFSET + end.x * SCALE} ${OFFSET + end.y * SCALE}`;
}

function errorPaths(drawing: CountryDrawing, reference: CountryDrawing) {
  const paths = { outside: [] as string[], inside: [] as string[] };
  for (const ring of drawing) {
    for (let index = 0; index < ring.length; index += 1) {
      const start = ring[index];
      const end = ring[(index + 1) % ring.length];
      const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      if (closestOnBorder(midpoint, reference).distance <= VISUAL_MATCH_DISTANCE) continue;
      const position = pointInShape(midpoint, reference) ? "inside" : "outside";
      paths[position].push(segmentPath(start, end));
    }
  }
  return { outside: paths.outside.join(" "), inside: paths.inside.join(" ") };
}

function guidePoints(drawing: CountryDrawing) {
  const rings = drawing.filter((ring) => ring.length);
  const lengths = rings.map(ringLength);
  const totalLength = lengths.reduce((total, length) => total + length, 0);
  if (!totalLength) return [];

  const allocations = lengths.map((length, index) => {
    const exact = (length / totalLength) * MAX_DISTANCE_GUIDES;
    return { index, count: Math.floor(exact), remainder: exact % 1 };
  });
  let assigned = allocations.reduce((total, allocation) => total + allocation.count, 0);
  for (const allocation of allocations.toSorted((a, b) => b.remainder - a.remainder)) {
    if (assigned >= MAX_DISTANCE_GUIDES) break;
    allocations[allocation.index].count += 1;
    assigned += 1;
  }

  return rings.flatMap((ring, ringIndex) =>
    Array.from({ length: allocations[ringIndex].count }, (_, index) =>
      ring[Math.floor((index / allocations[ringIndex].count) * ring.length)],
    ),
  );
}

function distanceGuides(drawing: CountryDrawing, reference: CountryDrawing) {
  return guidePoints(drawing).flatMap((point) => {
    const target = closestOnBorder(point, reference);
    if (target.distance <= VISUAL_MATCH_DISTANCE) return [];
    return [
      {
        point,
        target: target.point,
        position: pointInShape(point, reference) ? "inside" : "outside",
      },
    ];
  });
}

export function CountryReveal({ evaluation }: { evaluation: CountryEvaluation }) {
  const errors = errorPaths(evaluation.drawing, evaluation.reference);
  const guides = distanceGuides(evaluation.drawing, evaluation.reference);
  return (
    <svg
      viewBox="0 0 1000 1000"
      role="img"
      aria-label={`Actual country border compared with your aligned drawing. Red portions of your outline fall outside the country; blue portions cut inside it; black portions closely match. Thin lines start on your outline and show the distance to the nearest actual border. Position and size are normalised before comparison. Score ${evaluation.score} out of 100.`}
      className="block aspect-square w-full rounded-[1.75rem] border border-black/15 bg-white/45"
    >
      <title>Actual country border and your aligned drawing</title>
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
          key={`guide-${index}`}
          x1={OFFSET + point.x * SCALE}
          y1={OFFSET + point.y * SCALE}
          x2={OFFSET + target.x * SCALE}
          y2={OFFSET + target.y * SCALE}
          pathLength="1"
          className={`country-reveal-connector country-reveal-connector--${position}`}
          strokeWidth="1.5"
          style={{ animationDelay: `${760 + index * 30}ms` }}
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
      {errors.outside ? (
        <path
          d={errors.outside}
          pathLength="1"
          fill="none"
          className="country-reveal-error country-reveal-error--outside"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {errors.inside ? (
        <path
          d={errors.inside}
          pathLength="1"
          fill="none"
          className="country-reveal-error country-reveal-error--inside"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {guides.map(({ point, position }, index) => (
        <circle
          key={`guide-origin-${index}`}
          cx={OFFSET + point.x * SCALE}
          cy={OFFSET + point.y * SCALE}
          r="3"
          className={`country-reveal-connector-origin country-reveal-connector-origin--${position}`}
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
          actual border
        </li>
        <li className="flex items-center gap-2">
          <span className="country-legend-drawing" aria-hidden="true" />
          close match
        </li>
        <li className="flex items-center gap-2">
          <span className="country-legend-outside" aria-hidden="true" />
          outside country
        </li>
        <li className="flex items-center gap-2">
          <span className="country-legend-inside" aria-hidden="true" />
          cuts inside
        </li>
      </ul>
      <p className="mt-3 font-mono text-micro leading-relaxed text-black/40">
        thin lines start on your outline and measure to the actual border · position and size are
        normalised
      </p>
    </div>
  );
}

export function CountryScoreDetails({ evaluation }: { evaluation: CountryEvaluation }) {
  return (
    <div className="mt-4">
      <dl className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-micro text-black/45">
        <div>
          <dt className="sr-only">Average border deviation</dt>
          <dd>average {evaluation.deviation}%</dd>
        </div>
        <div>
          <dt className="sr-only">Outside score contribution</dt>
          <dd>outside {evaluation.outsideDeviation}%</dd>
        </div>
        <div>
          <dt className="sr-only">Inside score contribution</dt>
          <dd>inside {evaluation.insideDeviation}%</dd>
        </div>
        <div>
          <dt className="sr-only">Missing border score contribution</dt>
          <dd>missed {evaluation.coverageDeviation}%</dd>
        </div>
        <div>
          <dt className="sr-only">Silhouette score contribution</dt>
          <dd>shape {evaluation.silhouetteDeviation}%</dd>
        </div>
        <div>
          <dt className="sr-only">Stroke quality score contribution</dt>
          <dd>strokes {evaluation.strokeDeviation}%</dd>
        </div>
        <div>
          <dt className="sr-only">Island score contribution</dt>
          <dd>islands {evaluation.islandDeviation}%</dd>
        </div>
      </dl>
      <p className="mt-2 font-mono text-micro leading-relaxed text-black/40">
        every check must hold — the weakest one limits your score
      </p>
    </div>
  );
}
