import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));

import { query } from "@/lib/platform/postgres.server";
import {
  createActivity,
  getOrCreateSettings,
  participantForTicket,
} from "@/features/event-scoring/store.server";
import { launchEventCentreGame } from "@/features/event-scoring/game-launch.server";
import { consumeOfficialGameResult } from "@/features/event-scoring/games.server";
import { registerOfficialGameResultConsumer } from "@/features/things/shared/official-game-results.server";
import { applyCentreAction, readCentreSnapshot } from "@/features/things/centre/centre-room.server";
import {
  CENTRE_CELL,
  centreCellId,
  centreEntrancePoint,
  generateCentreMaze,
} from "@/features/things/centre/centre-generator";
import type { CentrePoint, CentreRoute } from "@/features/things/centre/types";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

function solvedRoute(
  maze: ReturnType<typeof generateCentreMaze>,
  entranceIndex: number,
  elapsedMs: number,
): CentreRoute {
  const start = centreCellId(maze.rings - 1, maze.entranceSectors[entranceIndex]);
  const parents = new Map<string, string | null>([[CENTRE_CELL, null]]);
  const queue = [CENTRE_CELL];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const next of maze.links[queue[cursor]]) {
      if (parents.has(next)) continue;
      parents.set(next, queue[cursor]);
      queue.push(next);
    }
  }
  const cells = [start];
  while (cells.at(-1) !== CENTRE_CELL) cells.push(parents.get(cells.at(-1)!)!);
  const width = (1 - maze.centreRadius) / maze.rings;
  const raw: Array<Omit<CentrePoint, "t">> = [centreEntrancePoint(maze, entranceIndex)];
  for (const id of cells) {
    if (id === CENTRE_CELL) raw.push({ x: 0, y: 0 });
    else {
      const match = /^r(\d+)s(\d+)$/.exec(id)!;
      const radius = maze.centreRadius + (Number(match[1]) + 0.5) * width;
      const angle = ((Number(match[2]) + 0.5) / maze.sectors) * Math.PI * 2;
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
    wallHits: 0,
  };
}

describeWithDatabase("event-linked Centre scoring", () => {
  beforeAll(async () => {
    // In production the nitro plugin registers this consumer; tests wire it directly.
    registerOfficialGameResultConsumer(consumeOfficialGameResult);
    await applySchema();
  });
  beforeEach(async () => {
    await truncateAll();
    await query(
      `insert into events (slug, title, status, starts_at, timezone)
       values ('centre-night', 'Centre Night', 'published', now(), 'Europe/London')`,
    );
    await query(
      `insert into ticket_types (event_slug, id, name, quantity)
       values ('centre-night', 'standard', 'Standard', 10)`,
    );
    await query(
      `insert into tickets (id, event_slug, ticket_type_id, holder_name, order_id)
       values ('01ARZ3NDEKTSV4CT', 'centre-night', 'standard', 'Host', 'ord_centre')`,
    );
  });
  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    registerOfficialGameResultConsumer(undefined);
    await closeDatabase();
  });

  it("stores the finished room result before applying its configured event points once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T12:00:00Z"));
    const participant = await participantForTicket("01ARZ3NDEKTSV4CT");
    await getOrCreateSettings("centre-night");
    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'centre-night'`,
    );
    const activity = await createActivity({
      eventSlug: "centre-night",
      name: "Centre final",
      template: "placement",
      status: "live",
      rule: {
        mode: "placement",
        placementPoints: { "1": 7 },
        repeat: "once-per-source",
        requiresCheckIn: false,
      },
    });
    const launched = await launchEventCentreGame({
      eventSlug: "centre-night",
      activityId: activity.id,
      hostParticipantId: participant!.id,
      hostName: "Host",
      difficulty: 2,
      delayedRivals: false,
    });
    expect(launched.ok).toBe(true);
    if (!launched.ok) return;
    const seat = {
      roomId: launched.value.roomId,
      playerId: launched.value.playerId,
      playerToken: launched.value.playerToken,
    };
    await applyCentreAction({ ...seat, action: { type: "game.start" } });
    const armed = await applyCentreAction({ ...seat, action: { type: "arming.set", armed: true } });
    vi.setSystemTime((armed.snapshot?.course?.startsAt ?? Date.now()) + 10);
    const read = await readCentreSnapshot({ ...seat, lastSequence: 0, lastDigest: null });
    if (!read.ok || read.unchanged || !read.snapshot) throw new Error("Centre did not start");
    const course = read.snapshot.course!;
    const maze = generateCentreMaze({
      seed: course.seed,
      difficulty: course.difficulty,
      playerCount: 1,
    });
    const route = solvedRoute(maze, read.snapshot.players[0]!.entranceIndex!, 2_000);
    await applyCentreAction({
      ...seat,
      action: {
        type: "race.finish",
        courseHash: course.hash,
        route,
        claimedElapsedMs: 2_000,
      },
    });
    vi.setSystemTime(Date.now() + 1_300);
    await readCentreSnapshot({ ...seat, lastSequence: 0, lastDigest: null });

    vi.useRealTimers();
    await vi.waitFor(
      async () => {
        expect((await participantForTicket("01ARZ3NDEKTSV4CT"))?.balance).toBe(7);
      },
      { timeout: 2_000, interval: 20 },
    );
    expect(
      await query<{
        game_kind: string;
        game_instance_id: string;
        result_id: string;
        status: string;
        player_id: string;
      }>(
        `select results.game_kind,
                results.game_instance_id,
                results.result_id,
                results.status,
                results.players->0->>'playerId' as player_id
           from official_game_results results`,
      ),
    ).toEqual([
      {
        game_kind: "centre",
        game_instance_id: launched.value.roomId,
        result_id: "game:1",
        status: "processed",
        player_id: launched.value.playerId,
      },
    ]);
  });
});
