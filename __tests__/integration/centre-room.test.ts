import { afterEach, describe, expect, it, vi } from "vitest";

const deliveredResults = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
vi.mock("@/lib/platform/logger.server", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/features/things/shared/official-game-results.server", () => ({
  deliverOfficialResultsAfterCommit: vi.fn((queued: Array<{ envelope: Record<string, unknown> }>) =>
    deliveredResults.push(...queued.map(({ envelope }) => envelope)),
  ),
  persistRoomWithOfficialResults: vi.fn(),
  sealOfficialGameResult: vi.fn(
    (input: { channelId: string; revision: number; result: Record<string, unknown> }) => ({
      ...input.result,
      schemaVersion: 1,
      channelId: input.channelId,
      revision: input.revision,
      operation: "record",
      committedAt: "2026-08-08T12:00:00.000Z",
      payloadHash: "a".repeat(64),
    }),
  ),
}));

import {
  applyCentreAction,
  createCentreRoom,
  joinCentreRoom,
  readCentreReplay,
  readCentreSnapshot,
} from "../../features/things/centre/centre-room.server";
import {
  CENTRE_CELL,
  centreCellId,
  centreEntrancePoint,
  generateCentreMaze,
} from "../../features/things/centre/centre-generator";
import type { CentrePoint, CentreRoute } from "../../features/things/centre/types";

afterEach(() => {
  deliveredResults.length = 0;
  vi.useRealTimers();
});

interface Seat {
  roomId: string;
  playerId: string;
  playerToken: string;
}

function solvedRoute(
  maze: ReturnType<typeof generateCentreMaze>,
  entranceIndex: number,
  elapsedMs: number,
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
  const raw: Array<Omit<CentrePoint, "t">> = [centreEntrancePoint(maze, entranceIndex)];
  for (const id of cells) {
    if (id === CENTRE_CELL) raw.push({ x: 0, y: 0 });
    else {
      const match = /^r(\d+)s(\d+)$/.exec(id)!;
      const ring = Number(match[1]);
      const sector = Number(match[2]);
      const radius = maze.centreRadius + (ring + 0.5) * width;
      const angle = ((sector + 0.5) / maze.sectors) * Math.PI * 2;
      raw.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    }
  }
  return {
    segments: [
      raw.map((point, index) => ({
        ...point,
        t: Math.round((index / (raw.length - 1)) * elapsedMs),
      })),
    ],
    wallHits: 2,
  };
}

async function snapshot(seat: Seat) {
  const result = await readCentreSnapshot({ ...seat, lastSequence: 0, lastDigest: null });
  if (!result.ok || result.unchanged || !result.snapshot) throw new Error("Expected snapshot");
  return result.snapshot;
}

describe("Centre rooms", () => {
  it("emits one neutral official result only for an event-linked finished game", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T11:00:00Z"));
    const created = await createCentreRoom({
      hostName: "Abel",
      difficulty: 2,
      delayedRivals: false,
      officialResultChannelId: "gsc_test",
    });
    const seat = {
      roomId: created.roomId,
      playerId: created.playerId,
      playerToken: created.playerToken,
    };
    await applyCentreAction({ ...seat, action: { type: "game.start" } });
    const armed = await applyCentreAction({ ...seat, action: { type: "arming.set", armed: true } });
    vi.setSystemTime((armed.snapshot?.course?.startsAt ?? Date.now()) + 10);
    const racing = await snapshot(seat);
    const maze = generateCentreMaze({
      seed: racing.course!.seed,
      difficulty: racing.course!.difficulty,
      playerCount: 1,
    });
    const route = solvedRoute(maze, racing.players[0]!.entranceIndex!, 2_000);
    await applyCentreAction({
      ...seat,
      action: {
        type: "race.finish",
        courseHash: racing.course!.hash,
        route,
        claimedElapsedMs: 2_000,
      },
    });
    vi.setSystemTime(Date.now() + 1_300);
    expect((await snapshot(seat)).phase).toBe("finished");
    await snapshot(seat);

    expect(deliveredResults).toHaveLength(1);
    expect(deliveredResults[0]).toMatchObject({
      channelId: "gsc_test",
      gameKind: "centre",
      gameInstanceId: created.roomId,
      resultId: "game:1",
      revision: 1,
      scope: "game",
      players: [
        {
          playerId: created.playerId,
          outcome: "completed",
          placement: 1,
          won: true,
        },
      ],
    });
    expect(JSON.stringify(deliveredResults[0])).not.toContain("Abel");
  });

  it("arms every player, starts together, verifies finishes, and stores the replay separately", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T12:00:00Z"));
    const created = await createCentreRoom({
      hostName: "Abel",
      difficulty: 3,
      delayedRivals: true,
    });
    const joined = await joinCentreRoom({
      roomId: created.roomId,
      joinToken: created.joinToken,
      name: "Maya",
    });
    if (!joined.ok) throw new Error(joined.error);
    const seats: Seat[] = [
      { roomId: created.roomId, playerId: created.playerId, playerToken: created.playerToken },
      { roomId: created.roomId, playerId: joined.playerId, playerToken: joined.playerToken },
    ];

    const started = await applyCentreAction({ ...seats[0], action: { type: "game.start" } });
    expect(started.accepted).toBe(true);
    expect(started.snapshot?.phase).toBe("arming");
    await applyCentreAction({ ...seats[0], action: { type: "arming.set", armed: true } });
    const armed = await applyCentreAction({
      ...seats[1],
      action: { type: "arming.set", armed: true },
    });
    expect(armed.snapshot?.phase).toBe("countdown");
    const startsAt = armed.snapshot?.course?.startsAt;
    expect(startsAt).toBeTypeOf("number");

    vi.setSystemTime((startsAt ?? Date.now()) + 10);
    const racing = await snapshot(seats[0]);
    expect(racing.phase).toBe("racing");
    expect(new Set(racing.players.map(({ entranceIndex }) => entranceIndex)).size).toBe(2);
    const course = racing.course!;
    const maze = generateCentreMaze({
      seed: course.seed,
      difficulty: course.difficulty,
      playerCount: course.playerCount,
    });

    for (const [index, seat] of seats.entries()) {
      const view = await snapshot(seat);
      const entranceIndex = view.players.find(({ id }) => id === seat.playerId)?.entranceIndex;
      if (entranceIndex === null || entranceIndex === undefined) throw new Error("No entrance");
      const elapsed = 2_000 + index * 250;
      const route = solvedRoute(maze, entranceIndex, elapsed);
      const result = await applyCentreAction({
        ...seat,
        action: {
          type: "race.finish",
          courseHash: course.hash,
          route,
          claimedElapsedMs: elapsed,
        },
      });
      expect(result.accepted).toBe(true);
    }

    vi.setSystemTime(Date.now() + 1_300);
    const finished = await snapshot(seats[0]);
    expect(finished.phase).toBe("finished");
    expect(finished.players.map(({ place }) => place)).toEqual([1, 2]);
    const replay = await readCentreReplay(seats[0]);
    expect(replay.ok && replay.players).toHaveLength(2);
    expect(replay.ok && replay.players[0].route.wallHits).toBe(2);
  });

  it("rejects a direct line that crosses the maze walls", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T13:00:00Z"));
    const created = await createCentreRoom({
      hostName: "Abel",
      difficulty: 2,
      delayedRivals: false,
    });
    const seat = {
      roomId: created.roomId,
      playerId: created.playerId,
      playerToken: created.playerToken,
    };
    await applyCentreAction({ ...seat, action: { type: "game.start" } });
    const armed = await applyCentreAction({ ...seat, action: { type: "arming.set", armed: true } });
    vi.setSystemTime((armed.snapshot?.course?.startsAt ?? Date.now()) + 10);
    const racing = await snapshot(seat);
    const maze = generateCentreMaze({
      seed: racing.course!.seed,
      difficulty: racing.course!.difficulty,
      playerCount: 1,
    });
    const invalid = {
      segments: [[centreEntrancePoint(maze, 0), { x: 0, y: 0, t: 1_000 }]],
      wallHits: 0,
    };
    const result = await applyCentreAction({
      ...seat,
      action: {
        type: "race.finish",
        courseHash: racing.course!.hash,
        route: invalid,
        claimedElapsedMs: 1_000,
      },
    });
    expect(result.accepted).toBe(false);
    expect(result.ok && !result.accepted ? result.errorCode : null).toBe("invalid_route");
  });

  it("stores a verified DNF route after the finish window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T14:00:00Z"));
    const created = await createCentreRoom({
      hostName: "Abel",
      difficulty: 3,
      delayedRivals: false,
    });
    const joined = await joinCentreRoom({
      roomId: created.roomId,
      joinToken: created.joinToken,
      name: "Maya",
    });
    if (!joined.ok) throw new Error(joined.error);
    const seats: Seat[] = [
      { roomId: created.roomId, playerId: created.playerId, playerToken: created.playerToken },
      { roomId: created.roomId, playerId: joined.playerId, playerToken: joined.playerToken },
    ];
    await applyCentreAction({ ...seats[0], action: { type: "game.start" } });
    await applyCentreAction({ ...seats[0], action: { type: "arming.set", armed: true } });
    const armed = await applyCentreAction({
      ...seats[1],
      action: { type: "arming.set", armed: true },
    });
    vi.setSystemTime((armed.snapshot?.course?.startsAt ?? Date.now()) + 10);
    const racing = await snapshot(seats[0]);
    const maze = generateCentreMaze({
      seed: racing.course!.seed,
      difficulty: racing.course!.difficulty,
      playerCount: racing.course!.playerCount,
    });
    const hostEntrance = racing.players.find(({ id }) => id === seats[0].playerId)!.entranceIndex!;
    const guestEntrance = racing.players.find(({ id }) => id === seats[1].playerId)!.entranceIndex!;
    await applyCentreAction({
      ...seats[0],
      action: {
        type: "race.finish",
        courseHash: racing.course!.hash,
        route: solvedRoute(maze, hostEntrance, 2_000),
        claimedElapsedMs: 2_000,
      },
    });
    vi.setSystemTime(Date.now() + 8_100);
    expect((await snapshot(seats[1])).phase).toBe("finished");
    const partial = solvedRoute(maze, guestEntrance, 5_000);
    partial.segments[0] = partial.segments[0].slice(0, 4);
    const retired = await applyCentreAction({
      ...seats[1],
      action: { type: "race.retire", courseHash: racing.course!.hash, route: partial },
    });
    expect(retired.accepted).toBe(true);
    const replay = await readCentreReplay(seats[0]);
    expect(replay.ok && replay.players.map(({ finished }) => finished)).toEqual([true, false]);
  });
});
