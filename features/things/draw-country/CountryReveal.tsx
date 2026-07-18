import type { CountryEvaluation } from "./scoring";
import type { CountryDrawing, DrawPoint } from "./types";

const SCALE = 820;
const OFFSET = 90;
const MAX_GUIDES = 40;

function pathFor(ring: DrawPoint[], scale = 820, offset = 90) {
  if (!ring.length) return "";
  return `${ring.map((point, index) => `${index ? "L" : "M"}${offset + point.x * scale} ${offset + point.y * scale}`).join(" ")} Z`;
}

function closestOnSegment(point: DrawPoint, start: DrawPoint, end: DrawPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const progress = lengthSquared
    ? Math.max(
        0,
        Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
      )
    : 0;
  return { x: start.x + dx * progress, y: start.y + dy * progress };
}

function closestOnBorder(point: DrawPoint, rings: CountryDrawing) {
  let nearest = rings[0]?.[0] ?? point;
  let distance = Number.POSITIVE_INFINITY;
  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 1) {
      const candidate = closestOnSegment(point, ring[index], ring[(index + 1) % ring.length]);
      const nextDistance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
      if (nextDistance < distance) {
        distance = nextDistance;
        nearest = candidate;
      }
    }
  }
  return nearest;
}

function pointInRing(point: DrawPoint, ring: DrawPoint[]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInReference(point: DrawPoint, reference: CountryDrawing) {
  return reference.some((ring) => pointInRing(point, ring));
}

function guideLines(drawing: CountryDrawing, reference: CountryDrawing) {
  const points = drawing.flat();
  const stride = Math.max(1, Math.ceil(points.length / MAX_GUIDES));
  return points
    .filter((_, index) => index % stride === 0)
    .map((point) => ({
      point,
      target: closestOnBorder(point, reference),
      position: pointInReference(point, reference) ? "inside" : "outside",
    }));
}

export function CountryReveal({ evaluation }: { evaluation: CountryEvaluation }) {
  const guides = guideLines(evaluation.drawing, evaluation.reference);
  return (
    <svg
      viewBox="0 0 1000 1000"
      role="img"
      aria-label={`Actual country border compared with your aligned drawing. Red lines mark points outside the border and blue lines mark points inside it. Score ${evaluation.score} out of 100.`}
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
    <div className="mt-4 font-mono text-micro text-black/50">
      <ul className="flex flex-wrap gap-x-5 gap-y-3" aria-label="Comparison key">
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
      <p className="mt-3 max-w-2xl leading-relaxed text-black/45">
        Reference is the real border. Red reaches back from points outside it; blue from points
        inside it. Position and size are aligned before comparison.
      </p>
    </div>
  );
}
