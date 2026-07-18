import { closestOnBorder, pointInShape, ringArea, ringLength } from "./geometry";
import type { CountryDrawing, CountryOutline, CountryScore, DrawPoint } from "./types";

const REFERENCE_SAMPLES = 320;
const DRAWING_SAMPLES = 320;
const ALIGNMENT_TRIM = 0.025;
const MINIMUM_DRAWING_EXTENT = 8;
const MAX_POINT_DEVIATION = 0.5;
const COUNTRY_COORDINATE_SCALE = 10_000;
const BORDER_FIT_WEIGHT = 0.45;
const COVERAGE_WEIGHT = 0.45;
const ISLAND_BALANCE_WEIGHT = 0.1;

const SCORE_CALIBRATION = [
  { deviation: 0, score: 100 },
  { deviation: 0.01, score: 94 },
  { deviation: 0.02, score: 87 },
  { deviation: 0.05, score: 70 },
  { deviation: 0.1, score: 50 },
  { deviation: 0.15, score: 35 },
  { deviation: 0.2, score: 24 },
  { deviation: 0.3, score: 12 },
  { deviation: 0.45, score: 3 },
  { deviation: 0.55, score: 0 },
] as const;

interface NormalisedShape {
  rings: CountryDrawing;
  points: DrawPoint[];
}

interface ShapeBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface CountryEvaluation extends CountryScore {
  drawing: CountryDrawing;
  reference: CountryDrawing;
}

function sampleRing(points: DrawPoint[], count: number) {
  if (count <= 0) return [];
  if (points.length < 2) return points.slice(0, count);
  const segments = points.map((point, index) => ({
    from: point,
    to: points[(index + 1) % points.length],
    length: Math.hypot(
      point.x - points[(index + 1) % points.length].x,
      point.y - points[(index + 1) % points.length].y,
    ),
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
  if (!rings.length || count <= 0) return [];
  const lengths = rings.map(ringLength);
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (!total) return [];

  const allocations = lengths.map((length, index) => {
    const exact = (length / total) * count;
    return { index, count: Math.floor(exact), remainder: exact % 1 };
  });
  let assigned = allocations.reduce((sum, allocation) => sum + allocation.count, 0);
  for (const allocation of allocations.toSorted((a, b) => b.remainder - a.remainder)) {
    if (assigned >= count) break;
    allocations[allocation.index].count += 1;
    assigned += 1;
  }
  return rings.flatMap((ring, index) => sampleRing(ring, allocations[index].count));
}

function quantile(values: number[], position: number) {
  const ordered = values.toSorted((a, b) => a - b);
  const target = Math.max(0, Math.min(ordered.length - 1, (ordered.length - 1) * position));
  const lower = Math.floor(target);
  const upper = Math.ceil(target);
  const progress = target - lower;
  return ordered[lower] + (ordered[upper] - ordered[lower]) * progress;
}

function robustBounds(points: DrawPoint[]): ShapeBounds {
  const x = points.map((point) => point.x);
  const y = points.map((point) => point.y);
  return {
    minX: quantile(x, ALIGNMENT_TRIM),
    maxX: quantile(x, 1 - ALIGNMENT_TRIM),
    minY: quantile(y, ALIGNMENT_TRIM),
    maxY: quantile(y, 1 - ALIGNMENT_TRIM),
  };
}

function boundsExtent(bounds: ShapeBounds) {
  return Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
}

function boundsCentre(bounds: ShapeBounds) {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

function normaliseReference(country: CountryOutline): NormalisedShape {
  const width = country.aspect;
  const height = 1;
  const scale = Math.max(width, height);
  const offsetX = (1 - width / scale) / 2;
  const offsetY = (1 - height / scale) / 2;
  const rings = country.rings.map((ring) =>
    ring.map(([x, y]) => ({
      x: offsetX + (x / COUNTRY_COORDINATE_SCALE) * (width / scale),
      y: offsetY + (y / COUNTRY_COORDINATE_SCALE) * (height / scale),
    })),
  );
  return { rings, points: sampleShape(rings, REFERENCE_SAMPLES) };
}

function alignDrawing(input: CountryDrawing, reference: NormalisedShape): NormalisedShape | null {
  const usable = input.filter((ring) => ring.length >= 3);
  const sampled = sampleShape(usable, DRAWING_SAMPLES);
  if (sampled.length < 3 || reference.points.length < 3) return null;

  const drawingBounds = robustBounds(sampled);
  const referenceBounds = robustBounds(reference.points);
  const drawingExtent = boundsExtent(drawingBounds);
  const referenceExtent = boundsExtent(referenceBounds);
  if (drawingExtent < MINIMUM_DRAWING_EXTENT || referenceExtent <= 0) return null;

  const drawingCentre = boundsCentre(drawingBounds);
  const referenceCentre = boundsCentre(referenceBounds);
  const scale = referenceExtent / drawingExtent;
  const rings = usable.map((ring) =>
    ring.map(({ x, y }) => ({
      x: referenceCentre.x + (x - drawingCentre.x) * scale,
      y: referenceCentre.y + (y - drawingCentre.y) * scale,
    })),
  );
  return { rings, points: sampleShape(rings, DRAWING_SAMPLES) };
}

function borderFit(points: DrawPoint[], reference: CountryDrawing) {
  if (!points.length || !reference.length) return { border: 1, outside: 0, inside: 0 };

  let outside = 0;
  let inside = 0;
  for (const point of points) {
    const distance = Math.min(closestOnBorder(point, reference).distance, MAX_POINT_DEVIATION);
    if (pointInShape(point, reference)) inside += distance;
    else outside += distance;
  }
  return {
    border: (outside + inside) / points.length,
    outside: outside / points.length,
    inside: inside / points.length,
  };
}

function averageDistanceToBorder(points: DrawPoint[], border: CountryDrawing) {
  if (!points.length || !border.length) return 1;
  return (
    points.reduce(
      (total, point) =>
        total + Math.min(closestOnBorder(point, border).distance, MAX_POINT_DEVIATION),
      0,
    ) / points.length
  );
}

function areaDistribution(rings: CountryDrawing) {
  const areas = rings
    .map(ringArea)
    .filter((area) => area > 0)
    .toSorted((a, b) => b - a);
  const total = areas.reduce((sum, area) => sum + area, 0);
  return total ? areas.map((area) => area / total) : [];
}

function islandBalanceDeviation(reference: CountryDrawing, drawing: CountryDrawing) {
  const expected = areaDistribution(reference);
  const actual = areaDistribution(drawing);
  if (!expected.length || !actual.length) return 1;
  const length = Math.max(expected.length, actual.length);
  let difference = 0;
  for (let index = 0; index < length; index += 1)
    difference += Math.abs((expected[index] ?? 0) - (actual[index] ?? 0));
  return difference / 2;
}

function percentage(value: number) {
  return Math.round(value * 1_000) / 10;
}

export function scoreFromDeviation(deviation: number) {
  const bounded = Math.max(0, deviation);
  const upperIndex = SCORE_CALIBRATION.findIndex((point) => bounded <= point.deviation);
  if (upperIndex <= 0) return upperIndex === 0 ? SCORE_CALIBRATION[0].score : 0;

  const lower = SCORE_CALIBRATION[upperIndex - 1];
  const upper = SCORE_CALIBRATION[upperIndex];
  const progress = (bounded - lower.deviation) / (upper.deviation - lower.deviation);
  return Math.round(lower.score + (upper.score - lower.score) * progress);
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
  const drawing = alignDrawing(input, reference);
  if (!drawing)
    return {
      score: 0,
      deviation: 100,
      borderDeviation: 100,
      outsideDeviation: 0,
      insideDeviation: 0,
      coverageDeviation: 100,
      islandDeviation: 0,
      accuracy: "adventurous",
      drawing: [],
      reference: reference.rings,
    };

  const fit = borderFit(drawing.points, reference.rings);
  const coverage = averageDistanceToBorder(reference.points, drawing.rings);
  const islandBalance = islandBalanceDeviation(reference.rings, drawing.rings);
  const deviation =
    fit.border * BORDER_FIT_WEIGHT +
    coverage * COVERAGE_WEIGHT +
    islandBalance * ISLAND_BALANCE_WEIGHT;
  const score = scoreFromDeviation(deviation);
  return {
    score,
    deviation: percentage(deviation),
    borderDeviation: percentage(fit.border),
    outsideDeviation: percentage(fit.outside * BORDER_FIT_WEIGHT),
    insideDeviation: percentage(fit.inside * BORDER_FIT_WEIGHT),
    coverageDeviation: percentage(coverage * COVERAGE_WEIGHT),
    islandDeviation: percentage(islandBalance * ISLAND_BALANCE_WEIGHT),
    accuracy: accuracyFor(score),
    drawing: drawing.rings,
    reference: reference.rings,
  };
}

export function drawingIsValid(drawing: CountryDrawing) {
  return drawing.some((ring) => ring.length >= 3) && drawing.flat().length >= 6;
}
