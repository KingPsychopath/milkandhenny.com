import type { CountryEvaluation } from "./scoring";
import type { CountryDrawing, DrawPoint } from "./types";

function pathFor(ring: DrawPoint[], scale = 820, offset = 90) {
  if (!ring.length) return "";
  return `${ring.map((point, index) => `${index ? "L" : "M"}${offset + point.x * scale} ${offset + point.y * scale}`).join(" ")} Z`;
}

function closest(point: DrawPoint, candidates: DrawPoint[]) {
  let nearest = candidates[0];
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const next = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (next < distance) {
      distance = next;
      nearest = candidate;
    }
  }
  return nearest;
}

function guideLines(drawing: CountryDrawing, reference: CountryDrawing) {
  const targets = reference.flat();
  const points = drawing.flat();
  const stride = Math.max(1, Math.ceil(points.length / 32));
  return points
    .filter((_, index) => index % stride === 0)
    .map((point) => ({
      point,
      target: closest(point, targets),
    }));
}

export function CountryReveal({ evaluation }: { evaluation: CountryEvaluation }) {
  const guides = guideLines(evaluation.drawing, evaluation.reference);
  return (
    <svg
      viewBox="0 0 1000 1000"
      role="img"
      aria-label={`Reference outline compared with your drawing. Score ${evaluation.score} out of 100.`}
      className="block aspect-square w-full rounded-[1.75rem] border border-black/15 bg-white/45"
    >
      <title>Reference outline and your drawing</title>
      {guides.map(({ point, target }, index) => (
        <line
          key={index}
          x1={90 + point.x * 820}
          y1={90 + point.y * 820}
          x2={90 + target.x * 820}
          y2={90 + target.y * 820}
          className="stroke-amber-700/35"
          strokeWidth="1.5"
        />
      ))}
      {evaluation.reference.map((ring, index) => (
        <path
          key={`reference-${index}`}
          d={pathFor(ring)}
          fill="none"
          className="stroke-black/20"
          strokeWidth="4"
          strokeLinejoin="round"
          strokeDasharray="8 7"
        />
      ))}
      {evaluation.drawing.map((ring, index) => (
        <path
          key={`drawing-${index}`}
          d={pathFor(ring)}
          fill="none"
          className="stroke-black"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
