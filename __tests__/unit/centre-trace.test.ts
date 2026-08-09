import { describe, expect, it } from "vitest";
import {
  centreEntrancePoint,
  centreMazeCellAt,
  generateCentreMaze,
} from "../../features/things/centre/centre-generator";
import {
  moveCentreTrace,
  parseCentreRoute,
  validateCentreRouteProgress,
} from "../../features/things/centre/centre-trace";
import type { CentrePoint, CentreRoute } from "../../features/things/centre/types";

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Record a drag the way MazeBoard does: append slide-path points then the head. */
function record(
  maze: ReturnType<typeof generateCentreMaze>,
  route: CentreRoute,
  target: CentrePoint,
) {
  const segment = route.segments.at(-1)!;
  const previous = segment.at(-1)!;
  const result = moveCentreTrace(maze, previous, target);
  const additions = [...result.path];
  const last = additions.at(-1) ?? previous;
  if (result.finished || Math.hypot(result.point.x - last.x, result.point.y - last.y) > 0.003)
    additions.push(result.point);
  segment.push(...additions);
  return result;
}

describe("centre trace sliding", () => {
  it("slides along walls instead of pinning", () => {
    const maze = generateCentreMaze({ seed: 7, difficulty: 3, playerCount: 2 });
    const entrance = centreEntrancePoint(maze, 0);
    // Push diagonally: outward (into the outer wall) while turning. The old
    // trace stopped dead; the new one must keep the angular component moving.
    const angle = Math.atan2(entrance.y, entrance.x);
    const target: CentrePoint = {
      x: Math.cos(angle + 0.35) * 1.05,
      y: Math.sin(angle + 0.35) * 1.05,
      t: 400,
    };
    const result = moveCentreTrace(maze, entrance, target);
    expect(result.collided).toBe(true);
    const moved = Math.hypot(result.point.x - entrance.x, result.point.y - entrance.y);
    expect(moved).toBeGreaterThan(0.05);
    expect(centreMazeCellAt(maze, result.point)).not.toBeNull();
  });

  it("records routes that survive server validation, including wall pushes", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const difficulty = ((seed % 5) + 1) as 1 | 2 | 3 | 4 | 5;
      const maze = generateCentreMaze({ seed, difficulty, playerCount: 3 });
      const random = mulberry32(seed * 97 + 13);
      const entrance = centreEntrancePoint(maze, 0);
      const route: CentreRoute = { segments: [[entrance]], wallHits: 0 };
      let t = 0;
      for (let move = 0; move < 120; move += 1) {
        const head = route.segments.at(-1)!.at(-1)!;
        t += 30;
        // Random jittery finger, biased inward, often pressing into walls.
        const target: CentrePoint = {
          x: head.x * 0.92 + (random() - 0.5) * 0.3,
          y: head.y * 0.92 + (random() - 0.5) * 0.3,
          t,
        };
        const result = record(maze, route, target);
        if (result.collided) route.wallHits += 1;
        if (result.finished) break;
      }
      // Round-trip through the wire format like the server does.
      const parsed = parseCentreRoute(JSON.parse(JSON.stringify(route)));
      const validation = validateCentreRouteProgress(maze, 0, parsed);
      expect(validation).toMatchObject({ valid: true });
    }
  });
});
