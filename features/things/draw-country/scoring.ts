import { closestOnBorder, pointInShape, ringArea, ringLength } from "./geometry";
import type { CountryDrawing, CountryOutline, CountryScore, DrawPoint } from "./types";

const REFERENCE_SAMPLES = 320;
const DRAWING_SAMPLES = 320;
const ALIGNMENT_TRIM = 0.025;
const MINIMUM_DRAWING_EXTENT = 8;
const MAX_POINT_DEVIATION = 0.5;
const SILHOUETTE_GRID_SIZE = 48;
const SILHOUETTE_COMPACTNESS_BASELINE = 0.5;
const MINIMUM_SILHOUETTE_SENSITIVITY = 0.3;
const PERIMETER_ALLOWANCE = 1.25;
const COUNTRY_COORDINATE_SCALE = 10_000;
const BORDER_FIT_WEIGHT = 0.3;
const COVERAGE_WEIGHT = 0.3;
const BORDER_COVERAGE_GUARD_MULTIPLIER = 1.1;
const SILHOUETTE_GUARD_THRESHOLD = 0.3;
const SILHOUETTE_GUARD_EXCESS_WEIGHT = 1;
const MINIMUM_MISMATCH_EXCESS_WEIGHT = 0.25;
const MISMATCH_COMPACTNESS_DISCOUNT = 2 / 3;
const ENCLOSURE_INSIDE_TOLERANCE = 0.005;
const ENCLOSURE_OUTSIDE_THRESHOLD = 0.05;
const ENCLOSURE_SILHOUETTE_THRESHOLD = 0.2;
const ENCLOSURE_MINIMUM_DEVIATION = 0.18;
const SILHOUETTE_WEIGHT = 0.25;
const STROKE_QUALITY_WEIGHT = 0.1;
const ISLAND_BALANCE_WEIGHT = 0.05;

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

function silhouetteDeviation(reference: CountryDrawing, drawing: CountryDrawing) {
  let intersection = 0;
  let union = 0;
  for (let row = 0; row < SILHOUETTE_GRID_SIZE; row += 1) {
    for (let column = 0; column < SILHOUETTE_GRID_SIZE; column += 1) {
      const point = {
        x: (column + 0.5) / SILHOUETTE_GRID_SIZE,
        y: (row + 0.5) / SILHOUETTE_GRID_SIZE,
      };
      const inReference = pointInShape(point, reference);
      const inDrawing = pointInShape(point, drawing);
      if (inReference && inDrawing) intersection += 1;
      if (inReference || inDrawing) union += 1;
    }
  }
  if (union >= 12) return 1 - intersection / union;

  const referenceArea = reference.reduce((total, ring) => total + ringArea(ring), 0);
  const drawingArea = drawing.reduce((total, ring) => total + ringArea(ring), 0);
  const largestArea = Math.max(referenceArea, drawingArea);
  return largestArea ? Math.abs(referenceArea - drawingArea) / largestArea : 1;
}

function silhouetteSensitivity(reference: CountryDrawing) {
  const points = reference.flat();
  if (!points.length) return 1;
  const minX = Math.min(...points.map(({ x }) => x));
  const maxX = Math.max(...points.map(({ x }) => x));
  const minY = Math.min(...points.map(({ y }) => y));
  const maxY = Math.max(...points.map(({ y }) => y));
  const boundsArea = (maxX - minX) * (maxY - minY);
  if (!boundsArea) return 1;
  const fillRatio = reference.reduce((total, ring) => total + ringArea(ring), 0) / boundsArea;
  return Math.max(
    MINIMUM_SILHOUETTE_SENSITIVITY,
    Math.min(1, fillRatio / SILHOUETTE_COMPACTNESS_BASELINE),
  );
}

interface DrawingSegment {
  start: DrawPoint;
  end: DrawPoint;
  ringIndex: number;
  segmentIndex: number;
  ringSize: number;
}

function cross(origin: DrawPoint, first: DrawPoint, second: DrawPoint) {
  return (
    (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x)
  );
}

function segmentsCross(
  firstStart: DrawPoint,
  firstEnd: DrawPoint,
  secondStart: DrawPoint,
  secondEnd: DrawPoint,
) {
  const firstSideStart = cross(firstStart, firstEnd, secondStart);
  const firstSideEnd = cross(firstStart, firstEnd, secondEnd);
  const secondSideStart = cross(secondStart, secondEnd, firstStart);
  const secondSideEnd = cross(secondStart, secondEnd, firstEnd);
  return (
    firstSideStart * firstSideEnd < -Number.EPSILON &&
    secondSideStart * secondSideEnd < -Number.EPSILON
  );
}

function segmentsAreAdjacent(first: DrawingSegment, second: DrawingSegment) {
  if (first.ringIndex !== second.ringIndex) return false;
  const difference = Math.abs(first.segmentIndex - second.segmentIndex);
  const wrappedDifference = Math.min(difference, first.ringSize - difference);
  return wrappedDifference <= 3;
}

function strokeQualityDeviation(drawing: CountryDrawing, reference: CountryDrawing) {
  const lengths = drawing.map(ringLength);
  const totalLength = lengths.reduce((total, length) => total + length, 0);
  if (!totalLength) return 1;
  const referenceLength = reference.reduce((total, ring) => total + ringLength(ring), 0);

  const degenerateLength = drawing.reduce((total, ring, index) => {
    const length = lengths[index];
    const compactness = length ? ringArea(ring) / (length * length) : 0;
    return compactness < 0.001 ? total + length : total;
  }, 0);
  const segments: DrawingSegment[] = drawing.flatMap((ring, ringIndex) =>
    ring.map((start, segmentIndex) => ({
      start,
      end: ring[(segmentIndex + 1) % ring.length],
      ringIndex,
      segmentIndex,
      ringSize: ring.length,
    })),
  );
  let crossings = 0;
  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
      const first = segments[firstIndex];
      const second = segments[secondIndex];
      if (
        !segmentsAreAdjacent(first, second) &&
        segmentsCross(first.start, first.end, second.start, second.end)
      )
        crossings += 1;
    }
  }

  const crossingDeviation = Math.min(1, crossings / Math.max(3, segments.length * 0.03));
  const perimeterRatio = referenceLength ? totalLength / referenceLength : Number.POSITIVE_INFINITY;
  const perimeterDeviation = Math.min(1, Math.max(0, perimeterRatio - PERIMETER_ALLOWANCE));
  return Math.min(
    1,
    (degenerateLength / totalLength) * 0.75 + crossingDeviation + perimeterDeviation,
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

function strokeQualityScore(deviation: number) {
  const bounded = Math.max(0, Math.min(1, deviation));
  if (bounded <= 0.2) return 100;
  return Math.round(100 * ((1 - bounded) / 0.8) ** 1.7);
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
      mismatchDeviation: 0,
      borderDeviation: 100,
      outsideDeviation: 0,
      insideDeviation: 0,
      coverageDeviation: 100,
      silhouetteDeviation: 0,
      strokeDeviation: 0,
      islandDeviation: 0,
      accuracy: "adventurous",
      drawing: [],
      reference: reference.rings,
    };

  const fit = borderFit(drawing.points, reference.rings);
  const coverage = averageDistanceToBorder(reference.points, drawing.rings);
  const sensitivity = silhouetteSensitivity(reference.rings);
  const silhouette = silhouetteDeviation(reference.rings, drawing.rings) * sensitivity;
  const strokeQuality = strokeQualityDeviation(drawing.rings, reference.rings);
  const islandBalance = islandBalanceDeviation(reference.rings, drawing.rings);
  const weightedDeviation =
    fit.border * BORDER_FIT_WEIGHT +
    coverage * COVERAGE_WEIGHT +
    silhouette * SILHOUETTE_WEIGHT +
    strokeQuality * STROKE_QUALITY_WEIGHT +
    islandBalance * ISLAND_BALANCE_WEIGHT;
  const mismatchGuardDeviation =
    (fit.border + coverage) * BORDER_COVERAGE_GUARD_MULTIPLIER +
    Math.max(0, silhouette - SILHOUETTE_GUARD_THRESHOLD) * SILHOUETTE_GUARD_EXCESS_WEIGHT;
  const mismatchExcessWeight = Math.max(
    MINIMUM_MISMATCH_EXCESS_WEIGHT,
    1 - sensitivity * MISMATCH_COMPACTNESS_DISCOUNT,
  );
  const mismatchAdjustedDeviation =
    weightedDeviation +
    Math.max(0, mismatchGuardDeviation - weightedDeviation) * mismatchExcessWeight;
  const enclosesReference =
    fit.inside <= ENCLOSURE_INSIDE_TOLERANCE &&
    fit.outside >= ENCLOSURE_OUTSIDE_THRESHOLD &&
    silhouette >= ENCLOSURE_SILHOUETTE_THRESHOLD;
  const deviation = Math.max(
    mismatchAdjustedDeviation,
    enclosesReference ? ENCLOSURE_MINIMUM_DEVIATION : 0,
  );
  const mismatchDeviation = deviation - weightedDeviation;
  const score = Math.min(scoreFromDeviation(deviation), strokeQualityScore(strokeQuality));
  return {
    score,
    deviation: percentage(deviation),
    mismatchDeviation: percentage(mismatchDeviation),
    borderDeviation: percentage(fit.border),
    outsideDeviation: percentage(fit.outside * BORDER_FIT_WEIGHT),
    insideDeviation: percentage(fit.inside * BORDER_FIT_WEIGHT),
    coverageDeviation: percentage(coverage * COVERAGE_WEIGHT),
    silhouetteDeviation: percentage(silhouette * SILHOUETTE_WEIGHT),
    strokeDeviation: percentage(strokeQuality * STROKE_QUALITY_WEIGHT),
    islandDeviation: percentage(islandBalance * ISLAND_BALANCE_WEIGHT),
    accuracy: accuracyFor(score),
    drawing: drawing.rings,
    reference: reference.rings,
  };
}

export function drawingIsValid(drawing: CountryDrawing) {
  const pointCount = drawing.reduce((total, ring) => total + ring.length, 0);
  return (
    pointCount >= 6 &&
    drawing.some((ring) => {
      const length = ringLength(ring);
      return ring.length >= 3 && length > 0 && ringArea(ring) / (length * length) >= 0.001;
    })
  );
}
