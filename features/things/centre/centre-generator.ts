import type { CentreDifficulty, CentreMaze } from "./types";

export const CENTRE_CELL = "centre";

interface DifficultyPlan {
  rings: number;
  sectors: number;
  newestBias: number;
  targetDepthRatio: number;
}

const PLANS: Record<CentreDifficulty, DifficultyPlan> = {
  1: { rings: 4, sectors: 16, newestBias: 0.92, targetDepthRatio: 0.38 },
  2: { rings: 5, sectors: 20, newestBias: 0.78, targetDepthRatio: 0.34 },
  3: { rings: 6, sectors: 24, newestBias: 0.64, targetDepthRatio: 0.3 },
  4: { rings: 7, sectors: 28, newestBias: 0.48, targetDepthRatio: 0.27 },
  5: { rings: 8, sectors: 32, newestBias: 0.34, targetDepthRatio: 0.24 },
};

function cellId(ring: number, sector: number) {
  return `r${ring}s${sector}`;
}

export function centreCellId(ring: number, sector: number) {
  return cellId(ring, sector);
}

export function centreCellParts(id: string) {
  if (id === CENTRE_CELL) return null;
  const match = /^r(\d+)s(\d+)$/.exec(id);
  return match ? { ring: Number(match[1]), sector: Number(match[2]) } : null;
}

function mulberry32(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function mixedSeed(seed: number, candidate: number) {
  let value = (seed ^ Math.imul(candidate + 1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b) >>> 0;
  return Math.imul(value ^ (value >>> 13), 0xc2b2ae35) >>> 0;
}

function adjacency(rings: number, sectors: number) {
  const result: Record<string, string[]> = { [CENTRE_CELL]: [] };
  for (let ring = 0; ring < rings; ring += 1)
    for (let sector = 0; sector < sectors; sector += 1) {
      const id = cellId(ring, sector);
      const neighbours = [
        cellId(ring, (sector + sectors - 1) % sectors),
        cellId(ring, (sector + 1) % sectors),
      ];
      if (ring === 0) neighbours.push(CENTRE_CELL);
      else neighbours.push(cellId(ring - 1, sector));
      if (ring < rings - 1) neighbours.push(cellId(ring + 1, sector));
      result[id] = neighbours;
      if (ring === 0) result[CENTRE_CELL].push(id);
    }
  return result;
}

function generateTree(plan: DifficultyPlan, seed: number) {
  const random = mulberry32(seed);
  const neighbours = adjacency(plan.rings, plan.sectors);
  const links: Record<string, string[]> = Object.fromEntries(
    Object.keys(neighbours).map((id) => [id, []]),
  );
  const visited = new Set([CENTRE_CELL]);
  const active = [CENTRE_CELL];
  while (active.length > 0) {
    const activeIndex =
      random() < plan.newestBias ? active.length - 1 : Math.floor(random() * active.length);
    const current = active[activeIndex];
    const available = neighbours[current].filter((id) => !visited.has(id));
    if (available.length === 0) {
      active.splice(activeIndex, 1);
      continue;
    }
    const next = available[Math.floor(random() * available.length)];
    links[current].push(next);
    links[next].push(current);
    visited.add(next);
    active.push(next);
  }
  for (const value of Object.values(links)) value.sort();
  return links;
}

function depthsFromCentre(links: Record<string, string[]>) {
  const depths = new Map<string, number>([[CENTRE_CELL, 0]]);
  const parents = new Map<string, string | null>([[CENTRE_CELL, null]]);
  const queue = [CENTRE_CELL];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (const next of links[current]) {
      if (depths.has(next)) continue;
      depths.set(next, (depths.get(current) ?? 0) + 1);
      parents.set(next, current);
      queue.push(next);
    }
  }
  return { depths, parents };
}

function circularDistance(left: number, right: number, sectors: number) {
  const distance = Math.abs(left - right);
  return Math.min(distance, sectors - distance);
}

function entranceSet(
  targetDepth: number,
  playerCount: number,
  sectors: number,
  depthOf: (sector: number) => number,
) {
  const result = [
    Array.from({ length: sectors }, (_unused, sector) => sector).toSorted(
      (left, right) =>
        Math.abs(depthOf(left) - targetDepth) - Math.abs(depthOf(right) - targetDepth) ||
        left - right,
    )[0],
  ];
  while (result.length < playerCount) {
    let candidate = -1;
    let candidateScore = Number.POSITIVE_INFINITY;
    for (let sector = 0; sector < sectors; sector += 1) {
      if (result.includes(sector)) continue;
      const availableSpace = Math.min(
        ...result.map((selected) => circularDistance(sector, selected, sectors)),
      );
      const score = Math.abs(depthOf(sector) - targetDepth) * 50 - availableSpace * 4;
      if (score < candidateScore) {
        candidate = sector;
        candidateScore = score;
      }
    }
    result.push(candidate);
  }
  return result.toSorted((left, right) => left - right);
}

function pathMetrics(
  start: string,
  links: Record<string, string[]>,
  depths: Map<string, number>,
  parents: Map<string, string | null>,
) {
  let current: string | null = start;
  let decisions = 0;
  let turns = 0;
  let previousDirection = "";
  while (current && current !== CENTRE_CELL) {
    if (links[current].length >= 3) decisions += 1;
    const parent: string | null = parents.get(current) ?? null;
    if (!parent) break;
    const here = centreCellParts(current);
    const there = centreCellParts(parent);
    let direction = "in";
    if (here && there && here.ring === there.ring) direction = "round";
    if (previousDirection && previousDirection !== direction) turns += 1;
    previousDirection = direction;
    current = parent;
  }
  return { length: depths.get(start) ?? 0, decisions, turns };
}

function bestEntrances(links: Record<string, string[]>, plan: DifficultyPlan, playerCount: number) {
  const { depths, parents } = depthsFromCentre(links);
  const target = plan.rings * plan.sectors * plan.targetDepthRatio;
  let best: { sectors: number[]; lengths: number[]; score: number } | null = null;
  const depthOf = (sector: number) => depths.get(cellId(plan.rings - 1, sector)) ?? 0;
  const targetDepths = [
    ...new Set(Array.from({ length: plan.sectors }, (_unused, sector) => depthOf(sector))),
  ];
  for (const targetDepth of targetDepths) {
    const sectors = entranceSet(targetDepth, playerCount, plan.sectors, depthOf);
    const metrics = sectors.map((sector) =>
      pathMetrics(cellId(plan.rings - 1, sector), links, depths, parents),
    );
    const lengths = metrics.map(({ length }) => length);
    const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
    const spread = Math.max(...lengths) - Math.min(...lengths);
    const decisionSpread =
      Math.max(...metrics.map(({ decisions }) => decisions)) -
      Math.min(...metrics.map(({ decisions }) => decisions));
    const turnMean = metrics.reduce((sum, value) => sum + value.turns, 0) / metrics.length;
    const sortedSectors = sectors.toSorted((left, right) => left - right);
    const gaps = sortedSectors.map((sector, index) => {
      const next = sortedSectors[(index + 1) % sortedSectors.length];
      return (next - sector + plan.sectors) % plan.sectors;
    });
    const idealGap = plan.sectors / playerCount;
    const spacingError = gaps.reduce((sum, gap) => sum + Math.abs(gap - idealGap), 0);
    const score =
      (playerCount > 1
        ? (spread / Math.max(1, mean)) * 4_000 + decisionSpread * 25 + spacingError * 3
        : 0) +
      Math.abs(mean - target) * 2 -
      turnMean * 0.2;
    if (!best || score < best.score) best = { sectors, lengths, score };
  }
  return best!;
}

function mazeHash(links: Record<string, string[]>, entrances: number[]) {
  const text = `${Object.entries(links)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([id, linked]) => `${id}:${linked.join(",")}`)
    .join("|")}|${entrances.join(",")}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

export function generateCentreMaze(input: {
  seed: number;
  difficulty: CentreDifficulty;
  playerCount: number;
}): CentreMaze {
  const plan = PLANS[input.difficulty];
  const playerCount = Math.max(1, Math.min(8, Math.floor(input.playerCount)));
  let selected:
    | { links: Record<string, string[]>; entrances: number[]; lengths: number[]; score: number }
    | undefined;
  // Entrance selection evaluates the full outer ring for every tree, so a few dozen candidates give
  // the scorer enough useful choice without delaying the reveal on a slower phone.
  for (let candidate = 0; candidate < 48; candidate += 1) {
    const links = generateTree(plan, mixedSeed(input.seed, candidate));
    const entrances = bestEntrances(links, plan, playerCount);
    if (!selected || entrances.score < selected.score)
      selected = {
        links,
        entrances: entrances.sectors,
        lengths: entrances.lengths,
        score: entrances.score,
      };
  }
  const chosen = selected!;
  return {
    seed: input.seed >>> 0,
    difficulty: input.difficulty,
    rings: plan.rings,
    sectors: plan.sectors,
    centreRadius: 0.105,
    links: chosen.links,
    entranceSectors: chosen.entrances,
    solutionLengths: chosen.lengths,
    hash: mazeHash(chosen.links, chosen.entrances),
  };
}

export function centreMazeCellAt(maze: CentreMaze, point: { x: number; y: number }) {
  const radius = Math.hypot(point.x, point.y);
  if (radius <= maze.centreRadius) return CENTRE_CELL;
  if (radius > 1.02) return null;
  const width = (1 - maze.centreRadius) / maze.rings;
  const ring = Math.min(maze.rings - 1, Math.floor((radius - maze.centreRadius) / width));
  const angle = (Math.atan2(point.y, point.x) + Math.PI * 2) % (Math.PI * 2);
  const sector = Math.min(maze.sectors - 1, Math.floor((angle / (Math.PI * 2)) * maze.sectors));
  return cellId(ring, sector);
}

export function centreEntrancePoint(maze: CentreMaze, entranceIndex: number) {
  const sector = maze.entranceSectors[entranceIndex] ?? maze.entranceSectors[0] ?? 0;
  const angle = ((sector + 0.5) / maze.sectors) * Math.PI * 2;
  return { x: Math.cos(angle) * 0.985, y: Math.sin(angle) * 0.985, t: 0 };
}

export function centreViewRotation(maze: CentreMaze, entranceIndex: number) {
  const point = centreEntrancePoint(maze, entranceIndex);
  return Math.PI / 2 - Math.atan2(point.y, point.x);
}

export function rotateCentrePoint<T extends { x: number; y: number }>(point: T, angle: number): T {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    ...point,
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  };
}

export function centreMazeLinked(maze: CentreMaze, from: string, to: string) {
  return maze.links[from]?.includes(to) ?? false;
}
