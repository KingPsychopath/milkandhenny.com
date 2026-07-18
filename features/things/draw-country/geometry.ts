import type { CountryDrawing, DrawPoint } from "./types";

export function ringLength(points: DrawPoint[]) {
  if (points.length < 2) return 0;
  return points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length];
    return total + Math.hypot(point.x - next.x, point.y - next.y);
  }, 0);
}

export function ringArea(points: DrawPoint[]) {
  if (points.length < 3) return 0;
  const doubled = points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length];
    return total + point.x * next.y - next.x * point.y;
  }, 0);
  return Math.abs(doubled / 2);
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

export function closestOnBorder(point: DrawPoint, rings: CountryDrawing) {
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
  return { point: nearest, distance };
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

export function pointInShape(point: DrawPoint, rings: CountryDrawing) {
  return rings.some((ring) => pointInRing(point, ring));
}
