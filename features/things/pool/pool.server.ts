import { createHash } from "node:crypto";

import { getRedis } from "@/lib/platform/redis.server";
import { query } from "@/lib/platform/postgres.server";
import { remainingMultiplayerRoomTtlSeconds } from "../shared/room-primitives.server";
import { publishMultiplayerRoomWake } from "../shared/multiplayer-runtime.server";
import {
  GamePoolJoinError,
  createPoolRoomAndJoin,
  gamePoolCapacity,
  joinPoolRoom,
} from "./game-adapters.server";
import { gamePoolAssignmentReceiptKey, gamePoolRoomSecretKey } from "./pool-keys";
import {
  createGamePoolAssignmentId,
  getGamePoolEntranceByToken,
  listGamePoolRoomRows,
  withGamePoolAllocation,
  type GamePoolRoomRow,
} from "./store.server";
import type {
  GamePoolAssignment,
  GamePoolNameVisibility,
  GamePoolPublicView,
  GamePoolRoomSummary,
} from "./types";
import { findGamePoolRunForClient } from "./membership.server";
import { recordGamePoolAllocation } from "./operations.server";
import { poolGameSettings } from "./presets";

interface ActiveAssignmentRow {
  id: string;
  room_id: string;
  display_name: string;
}

interface AssignmentReceipt {
  assignment: GamePoolAssignment;
}

function liveRun(run: { status: string; closesAt: string | null } | null | undefined) {
  return Boolean(
    run && run.status === "open" && (!run.closesAt || Date.parse(run.closesAt) > Date.now()),
  );
}

function publicName(name: string, visibility: GamePoolNameVisibility) {
  if (visibility === "counts") return null;
  if (visibility === "initials") return Array.from(name.trim())[0]?.toLocaleUpperCase() ?? null;
  return name;
}

function publicOccupantId(runId: string, assignmentId: string) {
  return createHash("sha256").update(`${runId}\0${assignmentId}`).digest("base64url").slice(0, 18);
}

export async function getGamePoolPublicView(token: string): Promise<GamePoolPublicView> {
  const entrance = await getGamePoolEntranceByToken(token);
  if (!entrance || entrance.retiredAt)
    return { found: false, message: "This game-night link is not active." };
  const run = entrance.run;
  if (!run)
    return {
      found: true,
      entrance: { label: entrance.label, game: entrance.game },
      run: null,
      rooms: [],
      message: "This game is not open right now.",
    };
  if (!liveRun(run))
    return {
      found: true,
      entrance: { label: entrance.label, game: entrance.game },
      run,
      rooms: [],
      message: run.status === "paused" ? "New joins are paused." : "This game has closed.",
    };

  const roomRows = await listGamePoolRoomRows(run.id);
  const assignments = await query<ActiveAssignmentRow>(
    `select id, room_id, display_name from game_pool_assignments
     where run_id = $1 and status = 'active'
     order by created_at`,
    [run.id],
  );
  const occupantsByRoom = new Map<string, Array<{ id: string; label: string }>>();
  for (const assignment of assignments) {
    const label = publicName(assignment.display_name, run.nameVisibility);
    if (!label) continue;
    const occupants = occupantsByRoom.get(assignment.room_id) ?? [];
    occupants.push({ id: publicOccupantId(run.id, assignment.id), label });
    occupantsByRoom.set(assignment.room_id, occupants);
  }
  const rooms: GamePoolRoomSummary[] = roomRows
    .filter((room) => room.status !== "closed")
    .map((room, index) => ({
      roomId: room.room_id,
      label: `room ${index + 1}`,
      status: room.status === "open" ? "open" : "started",
      playerCount: room.player_count,
      capacity: Math.min(room.capacity, run.targetSize),
      occupants: occupantsByRoom.get(room.room_id) ?? [],
      createdAt: room.created_at.toISOString(),
    }));
  return {
    found: true,
    entrance: { label: entrance.label, game: entrance.game },
    run,
    rooms,
  };
}

function validName(value: string) {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Add your name.");
  if (name.length > 32) throw new Error("Use 32 characters or fewer.");
  return name;
}

function validClientId(value: string) {
  const id = value.trim();
  if (id.length < 12 || id.length > 120 || !/^[A-Za-z0-9_-]+$/.test(id))
    throw new Error("This device could not be identified.");
  return id;
}

async function readReceipt(runId: string, clientId: string) {
  const redis = getRedis();
  const receipt = redis
    ? ((await redis.get<AssignmentReceipt>(gamePoolAssignmentReceiptKey(runId, clientId))) ?? null)
    : null;
  if (!receipt) return null;
  const rows = await query<{ active: boolean }>(
    `select true as active from game_pool_assignments
     where run_id = $1 and client_id = $2 and room_id = $3 and player_id = $4
       and status = 'active'`,
    [runId, clientId, receipt.assignment.roomId, receipt.assignment.playerId],
  );
  if (rows[0]?.active) return receipt;
  await redis?.del(gamePoolAssignmentReceiptKey(runId, clientId));
  return null;
}

async function saveRoomSecrets(input: {
  runId: string;
  roomId: string;
  clientId: string;
  joinToken: string;
  assignment: GamePoolAssignment;
}) {
  const redis = getRedis();
  if (!redis) throw new Error("Game-night rooms require Redis.");
  const ttl = remainingMultiplayerRoomTtlSeconds(input.assignment.expiresAt);
  await Promise.all([
    redis.set(gamePoolRoomSecretKey(input.runId, input.roomId), input.joinToken, { ex: ttl }),
    redis.set(
      gamePoolAssignmentReceiptKey(input.runId, input.clientId),
      { assignment: input.assignment } satisfies AssignmentReceipt,
      { ex: ttl },
    ),
  ]);
}

async function joinRegisteredRoom(input: {
  runId: string;
  game: GamePoolAssignment["game"];
  room: GamePoolRoomRow;
  clientId: string;
  name: string;
}) {
  const redis = getRedis();
  if (!redis) throw new Error("Game-night rooms require Redis.");
  const joinToken = await redis.get<string>(gamePoolRoomSecretKey(input.runId, input.room.room_id));
  if (!joinToken) throw new GamePoolJoinError("room_unavailable", "That room has closed.");
  return {
    assignment: await joinPoolRoom({
      game: input.game,
      roomId: input.room.room_id,
      joinToken,
      name: input.name,
      joinId: input.clientId,
    }),
    joinToken,
  };
}

export async function assignGamePoolRoom(input: {
  token: string;
  clientId: string;
  name: string;
  choice: "auto" | "new" | { roomId: string };
}) {
  const startedAt = performance.now();
  let failed = true;
  try {
    const entrance = await getGamePoolEntranceByToken(input.token);
    if (!entrance || entrance.retiredAt || !liveRun(entrance.run))
      throw new Error("This game is not accepting players right now.");
    const run = entrance.run;
    if (!run) throw new Error("This game is not open.");
    const clientId = validClientId(input.clientId);
    const name = validName(input.name);
    const receipt = await readReceipt(run.id, clientId);
    if (receipt) return receipt.assignment;

    const assignment = await withGamePoolAllocation(run.id, async (client) => {
      const lockedRun = await client.query<{
        status: string;
        closes_at: Date | null;
        allow_new_rooms: boolean;
        preset: unknown;
        target_size: number;
      }>(
        "select status, closes_at, allow_new_rooms, preset, target_size from game_pool_runs where id = $1 for update",
        [run.id],
      );
      const current = lockedRun.rows[0];
      if (
        !current ||
        current.status !== "open" ||
        (current.closes_at && current.closes_at.getTime() <= Date.now())
      )
        throw new Error("This game is not accepting players right now.");

      const existing = await client.query<{ room_id: string }>(
        `select room_id from game_pool_assignments
       where run_id = $1 and client_id = $2 and status = 'active'`,
        [run.id, clientId],
      );
      if (existing.rows[0]) {
        const retryReceipt = await readReceipt(run.id, clientId);
        if (retryReceipt) return retryReceipt.assignment;
        throw new Error("Your previous room is still active. Open it from your game page.");
      }

      const removed = await client.query<{ room_id: string }>(
        `select room_id from game_pool_assignments
       where run_id = $1 and client_id = $2 and status = 'removed'
       order by ended_at desc nulls last limit 1`,
        [run.id, clientId],
      );
      const excludedRoomId = removed.rows[0]?.room_id ?? null;

      const rooms = await client.query<GamePoolRoomRow>(
        `select * from game_pool_rooms where run_id = $1 and status = 'open'
       order by player_count desc, created_at for update`,
        [run.id],
      );
      let candidates: GamePoolRoomRow[] = [];
      if (typeof input.choice === "object") {
        const requestedRoomId = input.choice.roomId;
        candidates = rooms.rows.filter(
          ({ room_id, player_count }) =>
            room_id === requestedRoomId &&
            room_id !== excludedRoomId &&
            player_count < current.target_size,
        );
        if (candidates.length === 0) throw new Error("That room is no longer available.");
      } else if (input.choice === "auto") {
        candidates = rooms.rows.filter(
          ({ room_id, player_count }) =>
            room_id !== excludedRoomId && player_count < current.target_size,
        );
      }

      for (const room of candidates) {
        try {
          const joined = await joinRegisteredRoom({
            runId: run.id,
            game: entrance.game,
            room,
            clientId,
            name,
          });
          await client.query(
            "update game_pool_rooms set player_count = player_count + 1, updated_at = now() where run_id = $1 and room_id = $2",
            [run.id, room.room_id],
          );
          await client.query(
            `insert into game_pool_assignments
           (id, run_id, room_id, client_id, player_id, display_name)
           values ($1, $2, $3, $4, $5, $6)`,
            [
              createGamePoolAssignmentId(),
              run.id,
              room.room_id,
              clientId,
              joined.assignment.playerId,
              name,
            ],
          );
          await saveRoomSecrets({
            runId: run.id,
            roomId: room.room_id,
            clientId,
            joinToken: joined.joinToken,
            assignment: joined.assignment,
          });
          return joined.assignment;
        } catch (error) {
          if (
            error instanceof GamePoolJoinError &&
            ["game_started", "room_full", "room_unavailable", "invite_expired"].includes(error.code)
          ) {
            await client.query(
              "update game_pool_rooms set status = $3, updated_at = now() where run_id = $1 and room_id = $2",
              [run.id, room.room_id, error.code === "game_started" ? "started" : "closed"],
            );
            continue;
          }
          throw error;
        }
      }

      if (input.choice === "new" && !current.allow_new_rooms)
        throw new Error("Starting another room is not available.");
      if (input.choice === "auto" || input.choice === "new") {
        const created = await createPoolRoomAndJoin({
          gameSettings: poolGameSettings(current.preset, entrance.game),
          name,
          joinId: clientId,
        });
        const capacity = gamePoolCapacity(entrance.game);
        await client.query(
          `insert into game_pool_rooms (run_id, room_id, player_count, capacity)
         values ($1, $2, 1, $3)`,
          [run.id, created.assignment.roomId, capacity],
        );
        await client.query(
          `insert into game_pool_assignments
         (id, run_id, room_id, client_id, player_id, display_name)
         values ($1, $2, $3, $4, $5, $6)`,
          [
            createGamePoolAssignmentId(),
            run.id,
            created.assignment.roomId,
            clientId,
            created.assignment.playerId,
            name,
          ],
        );
        await saveRoomSecrets({
          runId: run.id,
          roomId: created.assignment.roomId,
          clientId,
          joinToken: created.joinToken,
          assignment: created.assignment,
        });
        return created.assignment;
      }
      throw new Error("That room is no longer available.");
    });
    await publishMultiplayerRoomWake("game-pool", run.id).catch(() => undefined);
    failed = false;
    return assignment;
  } finally {
    recordGamePoolAllocation({ durationMs: performance.now() - startedAt, failed });
  }
}

export async function releaseGamePoolAssignment(input: { token: string; clientId: string }) {
  const entrance = await getGamePoolEntranceByToken(input.token);
  const clientId = validClientId(input.clientId);
  const runId =
    entrance?.run?.id ?? (await findGamePoolRunForClient({ token: input.token, clientId }));
  if (!runId) return { ok: true as const };
  await withGamePoolAllocation(runId, async (client) => {
    const assignments = await client.query<{ room_id: string }>(
      `update game_pool_assignments set status = 'left', ended_at = now(), display_name = 'left'
       where run_id = $1 and client_id = $2 and status = 'active'
       returning room_id`,
      [runId, clientId],
    );
    const roomId = assignments.rows[0]?.room_id;
    if (roomId)
      await client.query(
        `update game_pool_rooms set
           player_count = greatest(0, player_count - 1),
           status = case when player_count <= 1 then 'closed' else status end,
           updated_at = now()
         where run_id = $1 and room_id = $2`,
        [runId, roomId],
      );
  });
  const redis = getRedis();
  if (redis) await redis.del(gamePoolAssignmentReceiptKey(runId, clientId));
  await publishMultiplayerRoomWake("game-pool", runId).catch(() => undefined);
  return { ok: true as const };
}

export async function authorizeGamePoolSocket(token: string, expectedRunId: string) {
  const entrance = await getGamePoolEntranceByToken(token);
  return entrance?.run?.id === expectedRunId ? { roomId: entrance.run.id } : null;
}
