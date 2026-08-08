import { describe, expect, it } from "vitest";
import {
  CENTRE_CELL,
  centreCellId,
  centreEntrancePoint,
  generateCentreMaze,
} from "../../features/things/centre/centre-generator";
import { validateCentreRoute } from "../../features/things/centre/centre-trace";
import type { CentrePoint } from "../../features/things/centre/types";

function solution(maze: ReturnType<typeof generateCentreMaze>, entranceIndex: number) {
  const start = centreCellId(maze.rings - 1, maze.entranceSectors[entranceIndex]);
  const parents = new Map<string, string | null>([[CENTRE_CELL, null]]);
  const queue = [CENTRE_CELL];
  for (let cursor = 0; cursor < queue.length; cursor += 1)
    for (const next of maze.links[queue[cursor]]) {
      if (parents.has(next)) continue;
      parents.set(next, queue[cursor]);
      queue.push(next);
    }
  const cells = [start];
  while (cells.at(-1) !== CENTRE_CELL) cells.push(parents.get(cells.at(-1)!)!);
  const width = (1 - maze.centreRadius) / maze.rings;
  const points: CentrePoint[] = [centreEntrancePoint(maze, entranceIndex)];
  for (const [index, id] of cells.entries()) {
    if (id === CENTRE_CELL) points.push({ x: 0, y: 0, t: index * 100 });
    else {
      const match = /^r(\d+)s(\d+)$/.exec(id)!;
      const ring = Number(match[1]);
      const sector = Number(match[2]);
      const radius = maze.centreRadius + (ring + 0.5) * width;
      const angle = ((sector + 0.5) / maze.sectors) * Math.PI * 2;
      points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, t: index * 100 });
    }
  }
  return points;
}

describe("centre maze generation", () => {
  it("is deterministic and produces one connected tree", () => {
    const first = generateCentreMaze({ seed: 12345, difficulty: 3, playerCount: 8 });
    const second = generateCentreMaze({ seed: 12345, difficulty: 3, playerCount: 8 });
    expect(second).toEqual(first);
    expect(Object.keys(first.links)).toHaveLength(first.rings * first.sectors + 1);
    expect(Object.values(first.links).reduce((sum, links) => sum + links.length, 0) / 2).toBe(
      Object.keys(first.links).length - 1,
    );
  });

  it("keeps multiplayer entrance routes close enough for a casual race", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const maze = generateCentreMaze({ seed, difficulty: 3, playerCount: 8 });
      const spread = Math.max(...maze.solutionLengths) - Math.min(...maze.solutionLengths);
      const mean = maze.solutionLengths.reduce((sum, value) => sum + value, 0) / 8;
      expect(spread / mean).toBeLessThan(0.12);
    }
  });

  it("accepts the generated solution and rejects a direct wall-crossing line", () => {
    const maze = generateCentreMaze({ seed: 808, difficulty: 2, playerCount: 1 });
    const route = { segments: [solution(maze, 0)], wallHits: 0 };
    expect(validateCentreRoute(maze, 0, route).valid).toBe(true);
    expect(
      validateCentreRoute(maze, 0, {
        segments: [[centreEntrancePoint(maze, 0), { x: 0, y: 0, t: 100 }]],
        wallHits: 0,
      }).valid,
    ).toBe(false);
  });
});
