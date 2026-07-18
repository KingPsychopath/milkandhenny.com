import type { CountryDrawing, CountryOutline, CountryScore, DrawPoint } from "./types";

const REFERENCE_SAMPLES = 320;
const DRAWING_SAMPLES = 320;

interface NormalisedShape {
  rings: CountryDrawing;
  points: DrawPoint[];
}

export interface CountryEvaluation extends CountryScore {
  drawing: CountryDrawing;
  reference: CountryDrawing;
}

function distance(a: DrawPoint, b: DrawPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function ringLength(points: DrawPoint[]) {
  if (points.length < 2) return 0;
  let total = 0;
  for (let index = 0; index < points.length; index += 1)
    total += distance(points[index], points[(index + 1) % points.length]);
  return total;
}

function sampleRing(points: DrawPoint[], count: number) {
  if (points.length < 2 || count <= 0) return points;
  const segments = points.map((point, index) => ({
    from: point,
    to: points[(index + 1) % points.length],
    length: distance(point, points[(index + 1) % points.length]),
  }));
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (!total) return points.slice(0, 1);
  const sampled: DrawPoint[] = [];
  let segmentIndex = 0;
  let traversed = 0;
  for (let index = 0; index < count; index += 1) {
    const target = (index / count) * total;
    while (
      segmentIndex < segments.length - 1 &&
      traversed + segments[segmentIndex].length < target
    ) {
      traversed += segments[segmentIndex].length;
      segmentIndex += 1;
    }
    const segment = segments[segmentIndex];
    const progress = segment.length ? (target - traversed) / segment.length : 0;
    sampled.push({
      x: segment.from.x + (segment.to.x - segment.from.x) * progress,
      y: segment.from.y + (segment.to.y - segment.from.y) * progress,
    });
  }
  return sampled;
}

function sampleShape(rings: CountryDrawing, count: number) {
  const lengths = rings.map(ringLength);
  const total = lengths.reduce((sum, value) => sum + value, 0);
  return rings.flatMap((ring, index) =>
    sampleRing(ring, Math.max(5, Math.round((lengths[index] / Math.max(total, 1)) * count))),
  );
}

function normaliseDrawing(rings: CountryDrawing): NormalisedShape | null {
  const usable = rings.filter((ring) => ring.length >= 3);
  const all = usable.flat();
  if (all.length < 3) return null;
  const minX = Math.min(...all.map(({ x }) => x));
  const maxX = Math.max(...all.map(({ x }) => x));
  const minY = Math.min(...all.map(({ y }) => y));
  const maxY = Math.max(...all.map(({ y }) => y));
  const width = maxX - minX;
  const height = maxY - minY;
  const scale = Math.max(width, height);
  if (scale < 8) return null;
  const offsetX = (1 - width / scale) / 2;
  const offsetY = (1 - height / scale) / 2;
  const normalised = usable.map((ring) =>
    ring.map(({ x, y }) => ({
      x: offsetX + (x - minX) / scale,
      y: offsetY + (y - minY) / scale,
    })),
  );
  return { rings: normalised, points: sampleShape(normalised, DRAWING_SAMPLES) };
}

function normaliseReference(country: CountryOutline): NormalisedShape {
  const width = country.aspect;
  const height = 1;
  const scale = Math.max(width, height);
  const offsetX = (1 - width / scale) / 2;
  const offsetY = (1 - height / scale) / 2;
  const rings = country.rings.map((ring) =>
    ring.map(([x, y]) => ({
      x: offsetX + (x / 1_000) * (width / scale),
      y: offsetY + (y / 1_000) * (height / scale),
    })),
  );
  return { rings, points: sampleShape(rings, REFERENCE_SAMPLES) };
}

function closestDistance(point: DrawPoint, candidates: DrawPoint[]) {
  let nearest = Number.POSITIVE_INFINITY;
  for (const candidate of candidates)
    nearest = Math.min(nearest, Math.hypot(point.x - candidate.x, point.y - candidate.y));
  return nearest;
}

function averageNearest(points: DrawPoint[], candidates: DrawPoint[]) {
  if (!points.length || !candidates.length) return 1;
  return points.reduce((sum, point) => sum + closestDistance(point, candidates), 0) / points.length;
}

function accuracyFor(score: number): CountryScore["accuracy"] {
  if (score >= 86) return "uncanny";
  if (score >= 66) return "close";
  if (score >= 40) return "recognisable";
  return "adventurous";
}

export function scoreCountryDrawing(
  country: CountryOutline,
  input: CountryDrawing,
): CountryEvaluation {
  const reference = normaliseReference(country);
  const drawing = normaliseDrawing(input);
  if (!drawing)
    return {
      score: 0,
      deviation: 100,
      accuracy: "adventurous",
      drawing: [],
      reference: reference.rings,
    };
  const outward = averageNearest(drawing.points, reference.points);
  const inward = averageNearest(reference.points, drawing.points);
  const deviation = outward * 0.45 + inward * 0.55;
  const islandPenalty = Math.max(
    0.82,
    1 - Math.abs(drawing.rings.length - reference.rings.length) * 0.018,
  );
  const score =
    deviation < 0.002
      ? 100
      : Math.max(
          0,
          Math.min(100, Math.round(100 * Math.exp(-7.4 * deviation) * islandPenalty)),
        );
  return {
    score,
    deviation: Math.round(deviation * 1_000) / 10,
    accuracy: accuracyFor(score),
    drawing: drawing.rings,
    reference: reference.rings,
  };
}

export function drawingIsValid(drawing: CountryDrawing) {
  return drawing.some((ring) => ring.length >= 3) && drawing.flat().length >= 6;
}
