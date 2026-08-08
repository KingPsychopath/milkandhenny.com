import {
  CENTRE_CELL,
  centreEntrancePoint,
  centreMazeCellAt,
  centreMazeLinked,
} from "./centre-generator";
import type { CentreMaze, CentrePoint, CentreRoute } from "./types";

export const CENTRE_MAX_ROUTE_POINTS = 4_096;
export const CENTRE_MAX_RESETS = 12;
export const CENTRE_MAX_RACE_MS = 5 * 60_000;

export interface CentreMoveResult {
  point: CentrePoint;
  collided: boolean;
  finished: boolean;
}

export function moveCentreTrace(
  maze: CentreMaze,
  from: CentrePoint,
  target: CentrePoint,
): CentreMoveResult {
  const distance = Math.hypot(target.x - from.x, target.y - from.y);
  const angularWidth = (Math.PI * 2 * maze.centreRadius) / maze.sectors;
  const radialWidth = (1 - maze.centreRadius) / maze.rings;
  const step = Math.max(0.0025, Math.min(0.008, angularWidth / 3, radialWidth / 4));
  const count = Math.max(1, Math.ceil(distance / step));
  let previous = from;
  let previousCell = centreMazeCellAt(maze, previous);
  for (let index = 1; index <= count; index += 1) {
    const progress = index / count;
    const point: CentrePoint = {
      x: from.x + (target.x - from.x) * progress,
      y: from.y + (target.y - from.y) * progress,
      t: Math.round(from.t + (target.t - from.t) * progress),
    };
    const cell = centreMazeCellAt(maze, point);
    if (
      !cell ||
      !previousCell ||
      (cell !== previousCell && !centreMazeLinked(maze, previousCell, cell))
    )
      return { point: previous, collided: true, finished: previousCell === CENTRE_CELL };
    previous = point;
    previousCell = cell;
  }
  return { point: previous, collided: false, finished: previousCell === CENTRE_CELL };
}

function validateRouteShape(
  maze: CentreMaze,
  entranceIndex: number,
  route: CentreRoute,
  mustFinish: boolean,
) {
  if (
    route.segments.length < 1 ||
    route.segments.length > CENTRE_MAX_RESETS + 1 ||
    !Number.isInteger(route.wallHits) ||
    route.wallHits < 0 ||
    route.wallHits > 10_000
  )
    return { valid: false as const, reason: "Invalid route shape" };
  const points = route.segments.reduce((total, segment) => total + segment.length, 0);
  if (points < 1 || points > CENTRE_MAX_ROUTE_POINTS)
    return { valid: false as const, reason: "Invalid route length" };
  const entrance = centreEntrancePoint(maze, entranceIndex);
  let lastTime = 0;
  for (const segment of route.segments) {
    if (segment.length < 1) return { valid: false as const, reason: "Empty route segment" };
    const first = segment[0];
    if (Math.hypot(first.x - entrance.x, first.y - entrance.y) > 0.08)
      return { valid: false as const, reason: "Route did not start at the entrance" };
    for (let index = 0; index < segment.length; index += 1) {
      const point = segment[index];
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        !Number.isFinite(point.t) ||
        Math.hypot(point.x, point.y) > 1.03 ||
        point.t < lastTime ||
        point.t > CENTRE_MAX_RACE_MS
      )
        return { valid: false as const, reason: "Invalid route point" };
      if (index > 0) {
        const moved = moveCentreTrace(maze, segment[index - 1], point);
        if (moved.collided || Math.hypot(moved.point.x - point.x, moved.point.y - point.y) > 0.004)
          return { valid: false as const, reason: "Route crossed a wall" };
      }
      lastTime = point.t;
    }
  }
  const final = route.segments.at(-1)?.at(-1);
  if (!final || (mustFinish && centreMazeCellAt(maze, final) !== CENTRE_CELL))
    return { valid: false as const, reason: "Route did not reach the centre" };
  return { valid: true as const, elapsedMs: final.t, pointCount: points };
}

export function validateCentreRoute(maze: CentreMaze, entranceIndex: number, route: CentreRoute) {
  return validateRouteShape(maze, entranceIndex, route, true);
}

export function validateCentreRouteProgress(
  maze: CentreMaze,
  entranceIndex: number,
  route: CentreRoute,
) {
  return validateRouteShape(maze, entranceIndex, route, false);
}

export function parseCentreRoute(value: unknown): CentreRoute {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid route");
  const record = Object.fromEntries(Object.entries(value));
  if (!Array.isArray(record.segments)) throw new Error("Invalid route");
  let total = 0;
  const segments = record.segments.map((raw) => {
    if (!Array.isArray(raw) || raw.length < 1) throw new Error("Invalid route segment");
    total += raw.length;
    if (total > CENTRE_MAX_ROUTE_POINTS) throw new Error("Route is too detailed");
    return raw.map((candidate): CentrePoint => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
        throw new Error("Invalid route point");
      const point = Object.fromEntries(Object.entries(candidate));
      if (
        typeof point.x !== "number" ||
        typeof point.y !== "number" ||
        typeof point.t !== "number" ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        !Number.isFinite(point.t)
      )
        throw new Error("Invalid route point");
      return {
        x: Math.round(point.x * 10_000) / 10_000,
        y: Math.round(point.y * 10_000) / 10_000,
        t: Math.round(point.t),
      };
    });
  });
  const wallHits = record.wallHits;
  if (!Number.isInteger(wallHits) || typeof wallHits !== "number") throw new Error("Invalid route");
  return { segments, wallHits };
}
