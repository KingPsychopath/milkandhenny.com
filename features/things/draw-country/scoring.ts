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
// How many RMS radii from the robust centroid a sampled point may sit before registration treats
// it as a stray mark rather than part of the shape.
const OUTLIER_SPREAD_RADII = 3;
// Below these differences the box and moment registrations describe the same placement, and one
// local search suffices.
const SEED_AGREEMENT_SCALE = 0.01;
const SEED_AGREEMENT_OFFSET = 0.005;
// The drawn-proportions registration is what the player sees, so it is the default reading; the
// moment registration takes over only when it fits this much better. Archipelagos drawn with
// mis-sized islands register two to four times better through moments, while shapes where the
// two readings merely disagree about which side of the border to straddle sit well above this.
const MOMENT_PREFERENCE_MARGIN = 0.7;
const MINIMUM_DRAWING_EXTENT = 8;
const MAX_POINT_DEVIATION = 0.5;
const SILHOUETTE_GRID_SIZE = 48;
const SILHOUETTE_BORDER_SAMPLES = 480;
const SILHOUETTE_COMPACTNESS_BASELINE = 0.5;
const MINIMUM_SILHOUETTE_SENSITIVITY = 0.15;
// A strong aligned border fit proves that alignment clarified the same shape; a weak fit keeps the
// pre-alignment guard that stops boxes and one recognisable country being accepted as another.
// Border fit alone drives the fade — never coverage: an archipelago drawn a few islands short has
// terrible coverage however faithfully those islands track the border, and coverage already
// charges for the missing coast on its own. Honest strokes track the border within a few
// hundredths; boxes and wrong countries sit at five hundredths and beyond.
const ALIGNMENT_GUARD_FIT_FLOOR = 0.02;
const ALIGNMENT_GUARD_FIT_CEILING = 0.06;
// Enclosure severity fades over a shorter run of border fit than the mismatch guard: a container
// cannot hug a real coastline — boxes sit at four hundredths and beyond — while the archipelago
// drawings the fade protects track their islands well under three.
const ENCLOSURE_FIT_CEILING = 0.045;
const PERIMETER_ALLOWANCE = 1.25;
const DEGENERATE_COMPACTNESS = 0.001;
const SEPARATE_STROKE_CROSSING_WEIGHT = 0.25;
// Lobe area, in the unit drawing frame, at which a self-crossing counts as deliberate doubling
// back rather than hand wobble. Careful traces of fjord coastlines carry crossings whose lobes
// measure well under a thousandth of the frame; a stroke looped through the shape encloses
// hundredths of it or more.
const SIGNIFICANT_LOBE_AREA = 0.004;
// Compactness (area over squared perimeter) below which a lobe reads as banks brushing rather
// than a loop. Tracing a hair-thin country — Chile, The Gambia, an atoll chain — inevitably
// sweeps one bank across the other, pinching off lobes as slender as the country itself; a
// stroke genuinely doubling back through the shape encloses a fat lobe. A circle sits at 0.08,
// a square at 0.0625, a ten-to-one sliver near 0.02.
const LOBE_COMPACTNESS_FLOOR = 0.03;
// A stroke that provably tracks the real border cannot also be a scribble: on shapes whose width
// is close to natural hand wobble, self-crossings appear no matter how honestly the player
// traces, so their charge scales with how far the drawing actually strays from the border and
// only bites in full once the line wanders this far off it.
const SELF_CROSSING_FULL_CHARGE_TRACKING = 0.15;
const SILHOUETTE_FULL_WEIGHT_FIT_ERROR = 0.3;
// Nobody draws every jag of a Douglas–Peucker coastline, and the atlas keeps its extreme vertices
// deliberately, so a country's own spikiness taxes an honest smooth line — ten times harder on
// Gabon or Iceland than on the Solomon Islands. The generalised reference is the border with its
// fine detail smoothed away: what an ideal player who captures the whole shape but none of the
// wiggles would draw. Scoring that against the true border prices each country's intrinsic detail,
// and the player is forgiven up to that allowance — capped there, so tracing the real detail still
// scores strictly higher, and faded by border fit so a wrong country or a box gains nothing.
const GENERALISED_SAMPLES = 256;
const GENERALISED_SMOOTHING_SHARE = 0.04;
const GENERALISED_MINIMUM_RING_POINTS = 8;
const DETAIL_FORGIVENESS = 0.8;
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
// A drawing only counts as a container when it actually holds the country: at least this share
// of the reference border must sit inside the drawn strokes. Without it, an archipelago drawn
// with its islands mis-placed looks the same as a box — no drawn point inside the reference,
// everything far from the border — and honest island attempts were floored as if they were
// containers. Half, not most: a sloppy container of the wrong proportions still slices off a
// good part of the country it is boxing in.
const ENCLOSURE_REFERENCE_SHARE = 0.5;
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
  if (bestError <= ALIGNMENT_ACCEPTABLE_ERROR)
    return { rings, preserveBaseline: false, error: bestError };
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

  if (best === identity) return { rings, preserveBaseline: false, error: bestError };
  return {
    rings: rings.map((ring) => ring.map((point) => transformPoint(point, centre, best))),
    preserveBaseline: fullSearch,
    error: bestError,
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

function smoothClosedRing(ring: DrawPoint[], window: number): DrawPoint[] {
  return ring.map((_, index) => {
    let x = 0;
    let y = 0;
    for (let offset = -window; offset <= window; offset += 1) {
      const point = ring[(index + offset + ring.length) % ring.length];
      x += point.x;
      y += point.y;
    }
    const span = window * 2 + 1;
    return { x: x / span, y: y / span };
  });
}

/** The reference with its fine detail smoothed away; rings too small to smooth stay as they are. */
function generalisedReference(reference: NormalisedShape): CountryDrawing {
  const lengths = reference.rings.map(ringLength);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (!total) return reference.rings;
  return reference.rings.map((ring, index) => {
    const count = Math.round((lengths[index] / total) * GENERALISED_SAMPLES);
    if (count < GENERALISED_MINIMUM_RING_POINTS) return ring;
    const resampled = sampleRing(ring, count);
    return smoothClosedRing(
      resampled,
      Math.max(1, Math.round(count * GENERALISED_SMOOTHING_SHARE)),
    );
  });
}

interface DetailAllowance {
  border: number;
  coverage: number;
  silhouette: number;
}

const detailAllowances = new Map<string, DetailAllowance>();

/** What a player who drew the whole shape but none of the wiggles would concede to this border. */
function detailAllowance(countryId: string, reference: NormalisedShape): DetailAllowance {
  const cached = detailAllowances.get(countryId);
  if (cached) return cached;
  const generalised = generalisedReference(reference);
  const allowance: DetailAllowance = {
    border: borderFit(sampleShape(generalised, DRAWING_SAMPLES), reference.rings).border,
    coverage: averageDistanceToBorder(reference.points, generalised),
    silhouette: silhouetteDeviation(reference.rings, generalised),
  };
  detailAllowances.set(countryId, allowance);
  return allowance;
}

/** How strongly the aligned border fit says this is an honest tracing rather than a wrong shape. */
function honestTrackingWeight(fitBorder: number) {
  return (
    1 -
    Math.max(
      0,
      Math.min(
        1,
        (fitBorder - ALIGNMENT_GUARD_FIT_FLOOR) /
          (ALIGNMENT_GUARD_FIT_CEILING - ALIGNMENT_GUARD_FIT_FLOOR),
      ),
    )
  );
}

function centroid(points: DrawPoint[]): DrawPoint {
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), {
    x: 0,
    y: 0,
  });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function rmsRadius(points: DrawPoint[], centre: DrawPoint) {
  return Math.sqrt(
    points.reduce(
      (total, point) => total + (point.x - centre.x) ** 2 + (point.y - centre.y) ** 2,
      0,
    ) / points.length,
  );
}

/**
 * Perimeter-weighted centroid and RMS spread, with far outliers — a stray dot, an accidental
 * flick — rejected so they cannot drag the registration. Squaring makes a plain RMS swing on a
 * single distant stroke harder than the bounding box it replaces ever did.
 */
function robustMoments(points: DrawPoint[]) {
  let centre = centroid(points);
  let spread = rmsRadius(points, centre);
  for (let pass = 0; pass < 2 && spread > 0; pass += 1) {
    const kept = points.filter(
      (point) =>
        Math.hypot(point.x - centre.x, point.y - centre.y) <= spread * OUTLIER_SPREAD_RADII,
    );
    if (kept.length === points.length || kept.length < 3) break;
    centre = centroid(kept);
    spread = rmsRadius(kept, centre);
  }
  return { centre, spread };
}

interface RegistrationSeed {
  drawingCentre: DrawPoint;
  referenceCentre: DrawPoint;
  scale: number;
}

function registerRings(rings: CountryDrawing, seed: RegistrationSeed): CountryDrawing {
  return rings.map((ring) =>
    ring.map(({ x, y }) => ({
      x: seed.referenceCentre.x + (x - seed.drawingCentre.x) * seed.scale,
      y: seed.referenceCentre.y + (y - seed.drawingCentre.y) * seed.scale,
    })),
  );
}

function seedsAgree(first: RegistrationSeed, second: RegistrationSeed) {
  const mappedOffset = Math.hypot(
    first.referenceCentre.x -
      second.referenceCentre.x -
      (first.drawingCentre.x - second.drawingCentre.x) * first.scale,
    first.referenceCentre.y -
      second.referenceCentre.y -
      (first.drawingCentre.y - second.drawingCentre.y) * first.scale,
  );
  return (
    Math.abs(first.scale / second.scale - 1) <= SEED_AGREEMENT_SCALE &&
    mappedOffset <= SEED_AGREEMENT_OFFSET
  );
}

/**
 * No single similarity registration reads every honest drawing correctly. Matching bounding
 * boxes keeps the drawing at its drawn proportions — which is how a mainland drawn without its
 * major islands still lands on the mainland, and how a box around the country stays visibly a
 * box around the country. Matching robust mass moments degrades gracefully when an archipelago
 * is drawn with its islands mis-sized or its specks left out, where a box quantile either
 * ignores a ring entirely or swings on it. So both interpretations are tried, each polished by
 * the local search, and the better fit is scored — while the guards always get to see the
 * drawn-proportions view, so a container around the country cannot shrink itself onto the
 * border and pass as tracing it.
 */
function alignDrawing(input: CountryDrawing, reference: NormalisedShape): AlignedShape | null {
  const usable = input.filter((ring) => ring.length >= 3);
  const sampled = sampleShape(usable, DRAWING_SAMPLES);
  if (sampled.length < 3 || reference.points.length < 3) return null;

  const drawingBounds = robustBounds(sampled);
  const referenceBounds = robustBounds(reference.points);
  const drawingExtent = boundsExtent(drawingBounds);
  const referenceExtent = boundsExtent(referenceBounds);
  if (drawingExtent < MINIMUM_DRAWING_EXTENT || referenceExtent <= 0) return null;

  const boundsSeed: RegistrationSeed = {
    drawingCentre: boundsCentre(drawingBounds),
    referenceCentre: boundsCentre(referenceBounds),
    scale: referenceExtent / drawingExtent,
  };
  const drawingMoments = robustMoments(sampled);
  const referenceMoments = robustMoments(reference.points);
  const momentSeed: RegistrationSeed | null =
    drawingMoments.spread > 0 && referenceMoments.spread > 0
      ? {
          drawingCentre: drawingMoments.centre,
          referenceCentre: referenceMoments.centre,
          scale: referenceMoments.spread / drawingMoments.spread,
        }
      : null;

  const baselineRings = registerRings(usable, boundsSeed);
  const seeds =
    momentSeed && !seedsAgree(boundsSeed, momentSeed) ? [boundsSeed, momentSeed] : [boundsSeed];
  const candidates = seeds.map((seed) => {
    const centred = seed === boundsSeed ? baselineRings : registerRings(usable, seed);
    return { centred, alignment: optimiseAlignment(centred, reference, seed.referenceCentre) };
  });
  const winner = candidates.reduce((best, candidate) =>
    candidate.alignment.error < best.alignment.error * MOMENT_PREFERENCE_MARGIN ? candidate : best,
  );
  const preserveBaseline = winner.alignment.preserveBaseline || winner.centred !== baselineRings;
  return {
    rings: winner.alignment.rings,
    points: sampleShape(winner.alignment.rings, DRAWING_SAMPLES),
    baselineRings: preserveBaseline ? baselineRings : winner.alignment.rings,
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

function referenceEnclosedShare(referencePoints: DrawPoint[], drawing: CountryDrawing) {
  if (!referencePoints.length) return 0;
  let inside = 0;
  for (const point of referencePoints) if (pointInShape(point, drawing)) inside += 1;
  return inside / referencePoints.length;
}

function enclosesReference(
  fit: ReturnType<typeof borderFit>,
  silhouette: number,
  enclosedShare: number,
) {
  return (
    fit.inside <= ENCLOSURE_INSIDE_TOLERANCE &&
    fit.outside >= ENCLOSURE_OUTSIDE_THRESHOLD &&
    silhouette >= ENCLOSURE_SILHOUETTE_THRESHOLD &&
    enclosedShare >= ENCLOSURE_REFERENCE_SHARE
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

/** Where two crossing segments meet. Callers must have established that they do cross. */
function segmentIntersection(
  firstStart: DrawPoint,
  firstEnd: DrawPoint,
  secondStart: DrawPoint,
  secondEnd: DrawPoint,
): DrawPoint {
  const denominator =
    (firstEnd.x - firstStart.x) * (secondEnd.y - secondStart.y) -
    (firstEnd.y - firstStart.y) * (secondEnd.x - secondStart.x);
  const progress =
    ((secondStart.x - firstStart.x) * (secondEnd.y - secondStart.y) -
      (secondStart.y - firstStart.y) * (secondEnd.x - secondStart.x)) /
    denominator;
  return {
    x: firstStart.x + (firstEnd.x - firstStart.x) * progress,
    y: firstStart.y + (firstEnd.y - firstStart.y) * progress,
  };
}

/**
 * How much a self-crossing reads as doubling back, from 0 (hand wobble) to 1 (a stroke looped
 * through the shape). The crossing pinches off a lobe — the crossing point plus the stretch of
 * ring between the two segments, or the ring's other half, whichever is smaller — and the
 * crossing is charged by that lobe's area, discounted when the lobe is itself a sliver.
 */
function crossingSeverity(ring: DrawPoint[], first: number, second: number, crossing: DrawPoint) {
  const inner = [crossing, ...ring.slice(first + 1, second + 1)];
  const outer = [crossing, ...ring.slice(second + 1), ...ring.slice(0, first + 1)];
  const lobe = ringArea(inner) <= ringArea(outer) ? inner : outer;
  const area = ringArea(lobe);
  const perimeter = ringLength(lobe);
  const compactness = perimeter ? area / (perimeter * perimeter) : 0;
  return (
    Math.min(1, area / SIGNIFICANT_LOBE_AREA) * Math.min(1, compactness / LOBE_COMPACTNESS_FLOOR)
  );
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

function strokeQualityDeviation(
  drawing: CountryDrawing,
  reference: CountryDrawing,
  borderTracking: number,
): StrokeQuality {
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
  // constantly — so those count for far less than a stroke crossing itself. A stroke crossing
  // itself is charged by how much it encloses, not how often it happens: tracing a fjord coastline
  // or a hair-thin country leaves the banks brushing across each other in crossings whose lobes
  // are microscopic, and a hand wobble must never read as doubling back through the shape.
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
      if (first.ringIndex === second.ringIndex)
        selfCrossings += crossingSeverity(
          drawing[first.ringIndex],
          first.segmentIndex,
          second.segmentIndex,
          segmentIntersection(first.start, first.end, second.start, second.end),
        );
      else strokeCrossings += 1;
    }
  }

  const threshold = Math.max(3, segments.length * 0.03);
  const trackingCharge = Math.min(1, borderTracking / SELF_CROSSING_FULL_CHARGE_TRACKING);
  const selfCrossingDeviation = Math.min(1, (selfCrossings * trackingCharge) / threshold);
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
  const rawSilhouette = silhouetteDeviation(reference.rings, drawing.rings);
  // Forgive each term up to the country's own detail cost — what even an ideal gestalt drawing
  // would concede to this border — scaled by how clearly the stroke tracks the border at all.
  // The guards below keep working from the unforgiven values.
  const allowance = detailAllowance(country.id, reference);
  const tracking = honestTrackingWeight(fit.border);
  const forgiven = (term: number, allowed: number) =>
    term - DETAIL_FORGIVENESS * tracking * Math.min(term, allowed);
  const borderTerm = forgiven(fit.border, allowance.border);
  const coverageTerm = forgiven(coverage, allowance.coverage);
  const silhouette = weightedSilhouette(
    forgiven(rawSilhouette, allowance.silhouette),
    sensitivity,
    borderTerm + coverageTerm,
  );
  const guardSilhouette = weightedSilhouette(rawSilhouette, sensitivity, fit.border + coverage);
  const strokeQuality = strokeQualityDeviation(
    drawing.rings,
    reference.rings,
    fit.border + coverage,
  );
  const islandBalance = islandBalanceDeviation(reference.rings, drawing.rings);
  const weightedDeviation =
    borderTerm * BORDER_FIT_WEIGHT +
    coverageTerm * COVERAGE_WEIGHT +
    silhouette * SILHOUETTE_WEIGHT +
    strokeQuality.deviation * STROKE_QUALITY_WEIGHT +
    islandBalance * ISLAND_BALANCE_WEIGHT;
  let guardDeviation = mismatchGuardDeviation(fit, coverage, guardSilhouette);
  // Enclosure fades in like the mismatch guard: seeing it in the drawn-proportions baseline only
  // counts to the extent the final fit failed to prove the drawing traces the same shape, so an
  // archipelago whose aligned strokes hug their islands is never floored as a container.
  let enclosureSeverity = enclosesReference(
    fit,
    guardSilhouette,
    referenceEnclosedShare(reference.points, drawing.rings),
  )
    ? 1
    : 0;
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
        (fit.border - ALIGNMENT_GUARD_FIT_FLOOR) /
          (ALIGNMENT_GUARD_FIT_CEILING - ALIGNMENT_GUARD_FIT_FLOOR),
      ),
    );
    guardDeviation = Math.max(
      guardDeviation,
      guardDeviation + (baselineGuard - guardDeviation) * guardWeight,
    );
    const enclosureWeight = Math.max(
      0,
      Math.min(
        1,
        (fit.border - ALIGNMENT_GUARD_FIT_FLOOR) /
          (ENCLOSURE_FIT_CEILING - ALIGNMENT_GUARD_FIT_FLOOR),
      ),
    );
    if (
      enclosureSeverity < enclosureWeight &&
      enclosesReference(
        baselineFit,
        baselineSilhouette,
        referenceEnclosedShare(reference.points, drawing.baselineRings),
      )
    )
      enclosureSeverity = enclosureWeight;
  }
  const mismatchExcessWeight = Math.max(
    MINIMUM_MISMATCH_EXCESS_WEIGHT,
    1 - sensitivity * MISMATCH_COMPACTNESS_DISCOUNT,
  );
  const mismatchAdjustedDeviation =
    weightedDeviation + Math.max(0, guardDeviation - weightedDeviation) * mismatchExcessWeight;
  const deviation = Math.max(
    mismatchAdjustedDeviation,
    ENCLOSURE_MINIMUM_DEVIATION * enclosureSeverity,
  );
  const mismatchDeviation = deviation - weightedDeviation;
  // Strong agreement in both directions means the player traced the same coastline: their line
  // stayed near the reference and the reference stayed near their line. Once the mismatch and
  // enclosure guards agree, a fragile silhouette raster must not turn that into a failure score.
  const recognitionFloor =
    !enclosureSeverity &&
    mismatchDeviation < RECOGNITION_MISMATCH_FADE &&
    strokeQuality.deviation < 0.5
      ? Math.round(
          Math.min(scoreFromDeviation(borderTerm), scoreFromDeviation(coverageTerm)) *
            BIDIRECTIONAL_RECOGNITION_FLOOR *
            (1 - mismatchDeviation / RECOGNITION_MISMATCH_FADE),
        )
      : 0;
  const score = Math.min(
    Math.max(scoreFromDeviation(deviation), recognitionFloor),
    strokeAbuseScore(strokeQuality.abuse),
  );
  // Reported terms are the forgiven ones the score is built from; inside and outside keep their
  // original proportions of the border term so the breakdown still sums to the deviation.
  const borderShare = fit.border > 0 ? borderTerm / fit.border : 1;
  return {
    score,
    deviation: percentage(deviation),
    mismatchDeviation: percentage(mismatchDeviation),
    borderDeviation: percentage(borderTerm),
    outsideDeviation: percentage(fit.outside * borderShare * BORDER_FIT_WEIGHT),
    insideDeviation: percentage(fit.inside * borderShare * BORDER_FIT_WEIGHT),
    coverageDeviation: percentage(coverageTerm * COVERAGE_WEIGHT),
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
