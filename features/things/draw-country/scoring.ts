import { closestOnBorder, pointInShape, ringArea, ringLength } from "./geometry";
import type { CountryDrawing, CountryOutline, CountryScore, DrawPoint } from "./types";

const REFERENCE_SAMPLES = 320;
const DRAWING_SAMPLES = 320;
const ALIGNMENT_TRIM = 0.025;
const ALIGNMENT_OPTIMISATION_SAMPLES = 32;
const ALIGNMENT_DISTANCE_TRIM = 0.05;
const ALIGNMENT_MINIMUM_RING_SHARE = 0.03;
const ALIGNMENT_ACCEPTABLE_ERROR = 0.002;
const ALIGNMENT_FULL_SEARCH_ERROR = 0.02;
const ALIGNMENT_REFINEMENTS = 4;
const ALIGNMENT_PASSES_PER_REFINEMENT = 2;
const ALIGNMENT_TRANSLATION_STEP = 0.025;
const ALIGNMENT_SCALE_STEP = 0.025;
const ALIGNMENT_ROTATION_STEP = (1.5 * Math.PI) / 180;
const ALIGNMENT_MAXIMUM_TRANSLATION = 0.05;
const ALIGNMENT_MINIMUM_SCALE = 0.95;
const ALIGNMENT_MAXIMUM_SCALE = 1.05;
const ALIGNMENT_MAXIMUM_ROTATION = (3 * Math.PI) / 180;
const MINIMUM_DRAWING_EXTENT = 8;
const MAX_POINT_DEVIATION = 0.5;
const SILHOUETTE_GRID_SIZE = 48;
const SILHOUETTE_BORDER_SAMPLES = 480;
const SILHOUETTE_COMPACTNESS_BASELINE = 0.5;
const MINIMUM_SILHOUETTE_SENSITIVITY = 0.15;
// A strong aligned border fit proves that alignment clarified the same shape; a weak fit keeps the
// pre-alignment guard that stops boxes and one recognisable country being accepted as another.
const ALIGNMENT_GUARD_FIT_FLOOR = 0.06;
const ALIGNMENT_GUARD_FIT_CEILING = 0.1;
const PERIMETER_ALLOWANCE = 1.25;
const DEGENERATE_COMPACTNESS = 0.001;
const SEPARATE_STROKE_CROSSING_WEIGHT = 0.25;
const SILHOUETTE_FULL_WEIGHT_FIT_ERROR = 0.3;
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
const BIDIRECTIONAL_RECOGNITION_FLOOR = 0.75;
const RECOGNITION_MISMATCH_FADE = 0.1;
const STROKE_ABUSE_FREE_ALLOWANCE = 0.5;

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

interface AlignedShape extends NormalisedShape {
  baselineRings: CountryDrawing;
}

interface ShapeBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface AlignmentTransform {
  x: number;
  y: number;
  scale: number;
  angle: number;
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

function sampleRings(rings: CountryDrawing, count: number) {
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
  return rings.map((ring, index) => sampleRing(ring, allocations[index].count));
}

function sampleShape(rings: CountryDrawing, count: number) {
  return sampleRings(rings, count).flat();
}

function silhouetteRings(rings: CountryDrawing) {
  const pointCount = rings.reduce((total, ring) => total + ring.length, 0);
  return pointCount <= SILHOUETTE_BORDER_SAMPLES
    ? rings
    : sampleRings(rings, SILHOUETTE_BORDER_SAMPLES);
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

function transformPoint(
  point: DrawPoint,
  centre: DrawPoint,
  transform: AlignmentTransform,
): DrawPoint {
  const x = point.x - centre.x;
  const y = point.y - centre.y;
  const cosine = Math.cos(transform.angle);
  const sine = Math.sin(transform.angle);
  return {
    x: centre.x + transform.x + (x * cosine - y * sine) * transform.scale,
    y: centre.y + transform.y + (x * sine + y * cosine) * transform.scale,
  };
}

function robustNearestPointDistance(source: DrawPoint[], target: DrawPoint[]) {
  const distances = source
    .map((point) =>
      Math.sqrt(
        target.reduce((nearest, candidate) => {
          const x = point.x - candidate.x;
          const y = point.y - candidate.y;
          return Math.min(nearest, x * x + y * y);
        }, Number.POSITIVE_INFINITY),
      ),
    )
    .toSorted((first, second) => first - second);
  const kept = Math.max(1, Math.floor(distances.length * (1 - ALIGNMENT_DISTANCE_TRIM)));
  return distances.slice(0, kept).reduce((total, distance) => total + distance, 0) / kept;
}

function symmetricAlignmentError(drawing: DrawPoint[], reference: DrawPoint[]) {
  return (
    (robustNearestPointDistance(drawing, reference) +
      robustNearestPointDistance(reference, drawing)) /
    2
  );
}

function significantAlignmentRings(rings: CountryDrawing) {
  const lengths = rings.map(ringLength);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const significant = rings.filter(
    (_, index) => lengths[index] / total >= ALIGNMENT_MINIMUM_RING_SHARE,
  );
  return significant.length ? significant : rings;
}

function optimiseAlignment(rings: CountryDrawing, reference: NormalisedShape, centre: DrawPoint) {
  const drawingPoints = sampleShape(
    significantAlignmentRings(rings),
    ALIGNMENT_OPTIMISATION_SAMPLES,
  );
  const referencePoints = sampleShape(
    significantAlignmentRings(reference.rings),
    ALIGNMENT_OPTIMISATION_SAMPLES,
  );
  const identity: AlignmentTransform = { x: 0, y: 0, scale: 1, angle: 0 };
  let best = identity;
  let bestError = symmetricAlignmentError(drawingPoints, referencePoints);
  if (bestError <= ALIGNMENT_ACCEPTABLE_ERROR) return { rings, preserveBaseline: false };
  const fullSearch = bestError > ALIGNMENT_FULL_SEARCH_ERROR;

  let translationStep = ALIGNMENT_TRANSLATION_STEP;
  let scaleStep = ALIGNMENT_SCALE_STEP;
  let rotationStep = ALIGNMENT_ROTATION_STEP;
  const errorFor = (transform: AlignmentTransform) =>
    symmetricAlignmentError(
      drawingPoints.map((point) => transformPoint(point, centre, transform)),
      referencePoints,
    );

  for (let refinement = 0; refinement < ALIGNMENT_REFINEMENTS; refinement += 1) {
    for (let pass = 0; pass < ALIGNMENT_PASSES_PER_REFINEMENT; pass += 1) {
      const candidates: AlignmentTransform[] = [
        ...(fullSearch
          ? [
              { ...best, x: best.x - translationStep },
              { ...best, x: best.x + translationStep },
              { ...best, y: best.y - translationStep },
              { ...best, y: best.y + translationStep },
              { ...best, scale: best.scale - scaleStep },
              { ...best, scale: best.scale + scaleStep },
            ]
          : []),
        { ...best, angle: best.angle - rotationStep },
        { ...best, angle: best.angle + rotationStep },
      ].filter(
        (candidate) =>
          Math.abs(candidate.x) <= ALIGNMENT_MAXIMUM_TRANSLATION &&
          Math.abs(candidate.y) <= ALIGNMENT_MAXIMUM_TRANSLATION &&
          candidate.scale >= ALIGNMENT_MINIMUM_SCALE &&
          candidate.scale <= ALIGNMENT_MAXIMUM_SCALE &&
          Math.abs(candidate.angle) <= ALIGNMENT_MAXIMUM_ROTATION,
      );
      let next = best;
      let nextError = bestError;
      for (const candidate of candidates) {
        const candidateError = errorFor(candidate);
        if (candidateError < nextError - Number.EPSILON) {
          next = candidate;
          nextError = candidateError;
        }
      }
      if (next === best) break;
      best = next;
      bestError = nextError;
    }
    translationStep /= 2;
    scaleStep /= 2;
    rotationStep /= 2;
  }

  if (best === identity) return { rings, preserveBaseline: false };
  return {
    rings: rings.map((ring) => ring.map((point) => transformPoint(point, centre, best))),
    preserveBaseline: fullSearch,
  };
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

function alignDrawing(input: CountryDrawing, reference: NormalisedShape): AlignedShape | null {
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
  const centredRings = usable.map((ring) =>
    ring.map(({ x, y }) => ({
      x: referenceCentre.x + (x - drawingCentre.x) * scale,
      y: referenceCentre.y + (y - drawingCentre.y) * scale,
    })),
  );
  const alignment = optimiseAlignment(centredRings, reference, referenceCentre);
  return {
    rings: alignment.rings,
    points: sampleShape(alignment.rings, DRAWING_SAMPLES),
    baselineRings: alignment.preserveBaseline ? centredRings : alignment.rings,
  };
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

function mismatchGuardDeviation(
  fit: ReturnType<typeof borderFit>,
  coverage: number,
  silhouette: number,
) {
  return (
    (fit.border + coverage) * BORDER_COVERAGE_GUARD_MULTIPLIER +
    Math.max(0, silhouette - SILHOUETTE_GUARD_THRESHOLD) * SILHOUETTE_GUARD_EXCESS_WEIGHT
  );
}

function enclosesReference(fit: ReturnType<typeof borderFit>, silhouette: number) {
  return (
    fit.inside <= ENCLOSURE_INSIDE_TOLERANCE &&
    fit.outside >= ENCLOSURE_OUTSIDE_THRESHOLD &&
    silhouette >= ENCLOSURE_SILHOUETTE_THRESHOLD
  );
}

function silhouetteDeviation(reference: CountryDrawing, drawing: CountryDrawing) {
  const sampledReference = silhouetteRings(reference);
  const sampledDrawing = silhouetteRings(drawing);
  let intersection = 0;
  let union = 0;
  for (let row = 0; row < SILHOUETTE_GRID_SIZE; row += 1) {
    for (let column = 0; column < SILHOUETTE_GRID_SIZE; column += 1) {
      const point = {
        x: (column + 0.5) / SILHOUETTE_GRID_SIZE,
        y: (row + 0.5) / SILHOUETTE_GRID_SIZE,
      };
      const inReference = pointInShape(point, sampledReference);
      const inDrawing = pointInShape(point, sampledDrawing);
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

/**
 * Thin, straggly countries lose silhouette overlap to the smallest wobble, so their shape term is
 * damped — but that same damping would shield an answer that is simply the wrong country, whose
 * overlap is poor too. Overlap alone cannot tell those apart; how closely the stroke tracks the
 * real border can. A drawing that follows the coastline keeps the forgiveness it needs, and one
 * that wanders loses it.
 */
function weightedSilhouette(raw: number, sensitivity: number, fitError: number) {
  const severity = Math.min(1, fitError / SILHOUETTE_FULL_WEIGHT_FIT_ERROR);
  return raw * (sensitivity + (1 - sensitivity) * severity);
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
  // Shapes are normalised to a longest side of one. The bounds area therefore also captures how
  // thin the country is, which matters because a one-pixel width error can erase its grid overlap.
  return Math.max(
    MINIMUM_SILHOUETTE_SENSITIVITY,
    Math.min(1, (fillRatio / SILHOUETTE_COMPACTNESS_BASELINE) * Math.sqrt(boundsArea)),
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

/**
 * Share of a shape's outline made of slivers too thin to enclose real area. In a drawing that means
 * scribbles; in a reference it means genuine geography, so the two are compared rather than the
 * drawing's share being charged outright.
 */
function degenerateShare(rings: CountryDrawing) {
  const lengths = rings.map(ringLength);
  const totalLength = lengths.reduce((total, length) => total + length, 0);
  if (!totalLength) return 0;
  const degenerateLength = rings.reduce((total, ring, index) => {
    const length = lengths[index];
    const compactness = length ? ringArea(ring) / (length * length) : 0;
    return compactness < DEGENERATE_COMPACTNESS ? total + length : total;
  }, 0);
  return degenerateLength / totalLength;
}

interface StrokeQuality {
  /** Full messiness signal, contributing its weight to the overall deviation. */
  deviation: number;
  /** The portion that caps the score no matter how well the drawing lands. */
  abuse: number;
}

function strokeQualityDeviation(drawing: CountryDrawing, reference: CountryDrawing): StrokeQuality {
  const lengths = drawing.map(ringLength);
  const totalLength = lengths.reduce((total, length) => total + length, 0);
  if (!totalLength) return { deviation: 1, abuse: 1 };
  const referenceLength = reference.reduce((total, ring) => total + ringLength(ring), 0);

  // Countries with thin islands — Myanmar's Mergui Archipelago, Croatia's coast — are themselves
  // built from slivers, so only scribbling beyond what the target already contains is a fault.
  const degenerate = Math.max(0, degenerateShare(drawing) - degenerateShare(reference));
  const segments: DrawingSegment[] = drawing.flatMap((ring, ringIndex) =>
    ring.map((start, segmentIndex) => ({
      start,
      end: ring[(segmentIndex + 1) % ring.length],
      ringIndex,
      segmentIndex,
      ringSize: ring.length,
    })),
  );
  // A scribble is a stroke that doubles back through itself. Two separate strokes overlapping is
  // ordinary in a country full of islands — drawing the Bahamas by hand means clipping neighbours
  // constantly — so those count for far less than a stroke crossing itself.
  let selfCrossings = 0;
  let strokeCrossings = 0;
  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
      const first = segments[firstIndex];
      const second = segments[secondIndex];
      if (
        segmentsAreAdjacent(first, second) ||
        !segmentsCross(first.start, first.end, second.start, second.end)
      )
        continue;
      if (first.ringIndex === second.ringIndex) selfCrossings += 1;
      else strokeCrossings += 1;
    }
  }

  const threshold = Math.max(3, segments.length * 0.03);
  const selfCrossingDeviation = Math.min(1, selfCrossings / threshold);
  const separateCrossingDeviation = Math.min(
    1,
    (strokeCrossings * SEPARATE_STROKE_CROSSING_WEIGHT) / threshold,
  );
  const perimeterRatio = referenceLength ? totalLength / referenceLength : Number.POSITIVE_INFINITY;
  const perimeterDeviation = Math.min(1, Math.max(0, perimeterRatio - PERIMETER_ALLOWANCE));

  // `abuse` is the part no amount of accuracy should excuse — padding the perimeter by tracing the
  // country repeatedly, scribbling, or looping a stroke through itself — and it caps the final
  // score outright. Untidy overlap between separate strokes only costs its share of the weighted
  // deviation, so a faithful archipelago drawn with clipping islands is marked on where it landed.
  const abuse = Math.min(1, degenerate * 0.75 + selfCrossingDeviation + perimeterDeviation);
  return { deviation: Math.min(1, abuse + separateCrossingDeviation), abuse };
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

function strokeAbuseScore(abuse: number) {
  const bounded = Math.max(0, Math.min(1, abuse));
  if (bounded <= STROKE_ABUSE_FREE_ALLOWANCE) return 100;
  return Math.round(100 * ((1 - bounded) / (1 - STROKE_ABUSE_FREE_ALLOWANCE)) ** 2.4);
}

export type CountryFeedbackKey = "outline" | "coverage" | "shape" | "strokes" | "islands";

export interface CountryFeedbackMetric {
  key: CountryFeedbackKey;
  label: string;
  score: number;
}

/** Player-facing strengths, expressed as matches where higher is always better. */
export function countryScoreBreakdown(
  evaluation: CountryEvaluation,
  includeIslands: boolean,
): CountryFeedbackMetric[] {
  const hasDrawing = evaluation.drawing.length > 0;
  const metrics: CountryFeedbackMetric[] = [
    {
      key: "outline",
      label: "border match",
      score: hasDrawing ? scoreFromDeviation(evaluation.borderDeviation / 100) : 0,
    },
    {
      key: "coverage",
      label: "coast remembered",
      score: hasDrawing
        ? scoreFromDeviation(evaluation.coverageDeviation / (COVERAGE_WEIGHT * 100))
        : 0,
    },
    {
      key: "shape",
      label: "shape match",
      score: hasDrawing
        ? scoreFromDeviation(evaluation.silhouetteDeviation / (SILHOUETTE_WEIGHT * 100))
        : 0,
    },
    {
      key: "strokes",
      label: "clean outline",
      score: hasDrawing
        ? strokeQualityScore(evaluation.strokeDeviation / (STROKE_QUALITY_WEIGHT * 100))
        : 0,
    },
  ];
  if (includeIslands)
    metrics.push({
      key: "islands",
      label: "island balance",
      score: hasDrawing
        ? scoreFromDeviation(evaluation.islandDeviation / (ISLAND_BALANCE_WEIGHT * 100))
        : 0,
    });
  return metrics;
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
  const silhouette = weightedSilhouette(
    silhouetteDeviation(reference.rings, drawing.rings),
    sensitivity,
    fit.border + coverage,
  );
  const strokeQuality = strokeQualityDeviation(drawing.rings, reference.rings);
  const islandBalance = islandBalanceDeviation(reference.rings, drawing.rings);
  const weightedDeviation =
    fit.border * BORDER_FIT_WEIGHT +
    coverage * COVERAGE_WEIGHT +
    silhouette * SILHOUETTE_WEIGHT +
    strokeQuality.deviation * STROKE_QUALITY_WEIGHT +
    islandBalance * ISLAND_BALANCE_WEIGHT;
  let guardDeviation = mismatchGuardDeviation(fit, coverage, silhouette);
  let enclosing = enclosesReference(fit, silhouette);
  if (drawing.rings !== drawing.baselineRings) {
    const baselinePoints = sampleShape(drawing.baselineRings, DRAWING_SAMPLES);
    const baselineFit = borderFit(baselinePoints, reference.rings);
    const baselineCoverage = averageDistanceToBorder(reference.points, drawing.baselineRings);
    const baselineSilhouette = weightedSilhouette(
      silhouetteDeviation(reference.rings, drawing.baselineRings),
      sensitivity,
      baselineFit.border + baselineCoverage,
    );
    const baselineGuard = mismatchGuardDeviation(baselineFit, baselineCoverage, baselineSilhouette);
    const guardWeight = Math.max(
      0,
      Math.min(
        1,
        (fit.border + coverage - ALIGNMENT_GUARD_FIT_FLOOR) /
          (ALIGNMENT_GUARD_FIT_CEILING - ALIGNMENT_GUARD_FIT_FLOOR),
      ),
    );
    guardDeviation = Math.max(
      guardDeviation,
      guardDeviation + (baselineGuard - guardDeviation) * guardWeight,
    );
    enclosing ||= enclosesReference(baselineFit, baselineSilhouette);
  }
  const mismatchExcessWeight = Math.max(
    MINIMUM_MISMATCH_EXCESS_WEIGHT,
    1 - sensitivity * MISMATCH_COMPACTNESS_DISCOUNT,
  );
  const mismatchAdjustedDeviation =
    weightedDeviation + Math.max(0, guardDeviation - weightedDeviation) * mismatchExcessWeight;
  const deviation = Math.max(
    mismatchAdjustedDeviation,
    enclosing ? ENCLOSURE_MINIMUM_DEVIATION : 0,
  );
  const mismatchDeviation = deviation - weightedDeviation;
  // Strong agreement in both directions means the player traced the same coastline: their line
  // stayed near the reference and the reference stayed near their line. Once the mismatch and
  // enclosure guards agree, a fragile silhouette raster must not turn that into a failure score.
  const recognitionFloor =
    !enclosing && mismatchDeviation < RECOGNITION_MISMATCH_FADE && strokeQuality.deviation < 0.5
      ? Math.round(
          Math.min(scoreFromDeviation(fit.border), scoreFromDeviation(coverage)) *
            BIDIRECTIONAL_RECOGNITION_FLOOR *
            (1 - mismatchDeviation / RECOGNITION_MISMATCH_FADE),
        )
      : 0;
  const score = Math.min(
    Math.max(scoreFromDeviation(deviation), recognitionFloor),
    strokeAbuseScore(strokeQuality.abuse),
  );
  return {
    score,
    deviation: percentage(deviation),
    mismatchDeviation: percentage(mismatchDeviation),
    borderDeviation: percentage(fit.border),
    outsideDeviation: percentage(fit.outside * BORDER_FIT_WEIGHT),
    insideDeviation: percentage(fit.inside * BORDER_FIT_WEIGHT),
    coverageDeviation: percentage(coverage * COVERAGE_WEIGHT),
    silhouetteDeviation: percentage(silhouette * SILHOUETTE_WEIGHT),
    strokeDeviation: percentage(strokeQuality.deviation * STROKE_QUALITY_WEIGHT),
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
