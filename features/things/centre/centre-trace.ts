import {
  CENTRE_CELL,
  centreEntrancePoint,
  centreMazeCellAt,
  centreMazeLinked,
} from "./centre-generator";
import type { CentreMaze, CentrePoint, CentreRoute } from "./types";

export const CENTRE_MAX_ROUTE_POINTS = 8_192;
export const CENTRE_MAX_RESETS = 12;
export const CENTRE_MAX_RACE_MS = 5 * 60_000;

export interface CentreMoveResult {
  point: CentrePoint;
  /**
   * Intermediate points that must be recorded before `point` so every straight
   * chord between recorded points stays wall-legal when the route is replayed.
   */
  path: CentrePoint[];
  collided: boolean;
  finished: boolean;
}

function centreTraceStep(maze: CentreMaze) {
  const angularWidth = (Math.PI * 2 * maze.centreRadius) / maze.sectors;
  const radialWidth = (1 - maze.centreRadius) / maze.rings;
  return Math.max(0.0025, Math.min(0.008, angularWidth / 3, radialWidth / 4));
}

function centreCellReachable(maze: CentreMaze, fromCell: string, cell: string | null) {
  return Boolean(cell && (cell === fromCell || centreMazeLinked(maze, fromCell, cell)));
}

/** Round to the wire precision of parseCentreRoute so client and server trace identically. */
function roundCentrePoint(point: CentrePoint): CentrePoint {
  return {
    x: Math.round(point.x * 10_000) / 10_000,
    y: Math.round(point.y * 10_000) / 10_000,
    t: Math.round(point.t),
  };
}

/**
 * True when stepping straight from `from` to `to` never crosses a wall. This
 * replicates the moveCentreTrace stepping loop exactly (same substep positions,
 * same rounding) so a clear chord is guaranteed to replay without sliding.
 */
function straightCentreChordClear(
  maze: CentreMaze,
  step: number,
  from: CentrePoint,
  to: CentrePoint,
) {
  let previous = from;
  let cell = centreMazeCellAt(maze, previous);
  const budget = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / step) + 8;
  for (let iteration = 0; iteration < budget; iteration += 1) {
    const remaining = Math.hypot(to.x - previous.x, to.y - previous.y);
    if (remaining < 1e-6) return true;
    const portion = Math.min(1, step / remaining);
    const point = roundCentrePoint({
      x: previous.x + (to.x - previous.x) * portion,
      y: previous.y + (to.y - previous.y) * portion,
      t: 0,
    });
    const next = centreMazeCellAt(maze, point);
    if (!cell || !centreCellReachable(maze, cell, next)) return false;
    previous = point;
    cell = next;
  }
  return false;
}

/** Slide a blocked step along the wall: keep the maze-legal component of the move. */
function slideCentreStep(
  maze: CentreMaze,
  previous: CentrePoint,
  previousCell: string,
  target: CentrePoint,
) {
  const radius = Math.hypot(previous.x, previous.y);
  const angle = Math.atan2(previous.y, previous.x);
  const targetRadius = Math.hypot(target.x, target.y);
  let deltaAngle = Math.atan2(target.y, target.x) - angle;
  if (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;
  else if (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2;
  const angular: CentrePoint | null =
    Math.abs(deltaAngle) * radius > 1e-4
      ? roundCentrePoint({
          x: Math.cos(angle + deltaAngle) * radius,
          y: Math.sin(angle + deltaAngle) * radius,
          t: target.t,
        })
      : null;
  const radial: CentrePoint | null =
    Math.abs(targetRadius - radius) > 1e-4
      ? roundCentrePoint({
          x: Math.cos(angle) * targetRadius,
          y: Math.sin(angle) * targetRadius,
          t: target.t,
        })
      : null;
  const candidates =
    Math.abs(deltaAngle) * radius >= Math.abs(targetRadius - radius)
      ? [angular, radial]
      : [radial, angular];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const cell = centreMazeCellAt(maze, candidate);
    if (centreCellReachable(maze, previousCell, cell)) return { point: candidate, cell: cell! };
  }
  return null;
}

export function moveCentreTrace(
  maze: CentreMaze,
  from: CentrePoint,
  target: CentrePoint,
): CentreMoveResult {
  const step = centreTraceStep(maze);
  const path: CentrePoint[] = [];
  let previous = roundCentrePoint(from);
  let previousCell = centreMazeCellAt(maze, previous);
  if (!previousCell) return { point: from, path, collided: true, finished: false };
  let collided = false;
  // The last recorded point: every accepted position must keep a wall-legal
  // straight chord back to it, or we record an elbow first.
  let anchor = previous;
  const accept = (point: CentrePoint, cell: string) => {
    const chord = Math.hypot(point.x - anchor.x, point.y - anchor.y);
    if (chord > step * 8 || !straightCentreChordClear(maze, step, anchor, point)) {
      path.push(previous);
      anchor = previous;
    }
    previous = point;
    previousCell = cell;
  };
  const budget = Math.ceil(Math.hypot(target.x - from.x, target.y - from.y) / step) * 3 + 8;
  for (let iteration = 0; iteration < budget; iteration += 1) {
    const remaining = Math.hypot(target.x - previous.x, target.y - previous.y);
    if (remaining < 1e-6) break;
    const portion = Math.min(1, step / remaining);
    const point = roundCentrePoint({
      x: previous.x + (target.x - previous.x) * portion,
      y: previous.y + (target.y - previous.y) * portion,
      t: previous.t + (target.t - previous.t) * portion,
    });
    const cell = centreMazeCellAt(maze, point);
    if (centreCellReachable(maze, previousCell, cell)) {
      accept(point, cell!);
      continue;
    }
    collided = true;
    const slid = slideCentreStep(maze, previous, previousCell, point);
    if (!slid) break;
    accept(slid.point, slid.cell);
  }
  if (path.at(-1) === previous) path.pop();
  return { point: previous, path, collided, finished: previousCell === CENTRE_CELL };
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
        // Sliding may graze walls (collided) yet still land on the recorded
        // point; only a landing gap means the route crossed a wall, because a
        // slide never moves past the target's angle or radius.
        const moved = moveCentreTrace(maze, segment[index - 1], point);
        if (Math.hypot(moved.point.x - point.x, moved.point.y - point.y) > 0.008)
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
