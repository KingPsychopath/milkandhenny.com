import { useMemo, useState } from "react";
import {
  CENTRE_CELL,
  centreCellId,
  centreEntrancePoint,
  generateCentreMaze,
} from "./centre-generator";
import { MazeBoard } from "./MazeBoard";
import type { CentreDifficulty, CentrePoint, CentreRoute } from "./types";

function solutionRoute(
  maze: ReturnType<typeof generateCentreMaze>,
  entranceIndex: number,
): CentreRoute {
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
    if (id === CENTRE_CELL) points.push({ x: 0, y: 0, t: (index + 1) * 150 });
    else {
      const match = /^r(\d+)s(\d+)$/.exec(id)!;
      const ring = Number(match[1]);
      const sector = Number(match[2]);
      const radius = maze.centreRadius + (ring + 0.5) * width;
      const angle = ((sector + 0.5) / maze.sectors) * Math.PI * 2;
      points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        t: (index + 1) * 150,
      });
    }
  }
  return { segments: [points], wallHits: 0 };
}

export function CentreDevHarness() {
  const [seed, setSeed] = useState(808);
  const [difficulty, setDifficulty] = useState<CentreDifficulty>(3);
  const [players, setPlayers] = useState(8);
  const [entrance, setEntrance] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  const maze = useMemo(
    () => generateCentreMaze({ seed, difficulty, playerCount: players }),
    [difficulty, players, seed],
  );
  const mean = maze.solutionLengths.reduce((sum, value) => sum + value, 0) / players;
  const spread = Math.max(...maze.solutionLengths) - Math.min(...maze.solutionLengths);
  const route = showSolution ? solutionRoute(maze, entrance) : { segments: [], wallHits: 0 };
  return (
    <div className="things-game things-game--night centre">
      <header className="centre-header">
        <span>centre dev harness</span>
        <span>{maze.hash}</span>
      </header>
      <main id="main" className="centre-launch">
        <h1 className="centre-title centre-title--small">Generation and rotation</h1>
        <div className="centre-dev-controls">
          <label>
            seed{" "}
            <input
              type="number"
              value={seed}
              onChange={(event) => setSeed(Number(event.target.value) >>> 0)}
            />
          </label>
          <label>
            difficulty{" "}
            <input
              type="range"
              min={1}
              max={5}
              value={difficulty}
              onChange={(event) => setDifficulty(Number(event.target.value) as CentreDifficulty)}
            />
          </label>
          <label>
            players{" "}
            <input
              type="range"
              min={1}
              max={8}
              value={players}
              onChange={(event) => {
                const value = Number(event.target.value);
                setPlayers(value);
                setEntrance((current) => Math.min(current, value - 1));
              }}
            />
          </label>
          <label>
            entrance{" "}
            <input
              type="range"
              min={0}
              max={players - 1}
              value={entrance}
              onChange={(event) => setEntrance(Number(event.target.value))}
            />
          </label>
          <label className="centre-check">
            <input
              type="checkbox"
              checked={showSolution}
              onChange={(event) => setShowSolution(event.target.checked)}
            />
            <span>show verified solution</span>
          </label>
        </div>
        <p className="centre-note">
          {maze.rings} rings · {maze.sectors} sectors · route lengths{" "}
          {maze.solutionLengths.join(", ")} · spread {((spread / mean) * 100).toFixed(1)}%
        </p>
        <MazeBoard
          maze={maze}
          entranceIndex={entrance}
          phase="replay"
          startsAt={null}
          route={route}
          playerColour={entrance % 8}
        />
      </main>
    </div>
  );
}
