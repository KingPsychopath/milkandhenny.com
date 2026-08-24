import { createHash, randomBytes } from "node:crypto";

import { query, transaction } from "@/lib/platform/postgres.server";
import {
  publishMultiplayerRoomTermination,
  publishMultiplayerRoomWake,
} from "../shared/multiplayer-runtime.server";
import { isGamePoolGame } from "./presets";
import type { GamePoolOperatorView, GamePoolRoomSummary, GamePoolRunStatus } from "./types";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function moderationId() {
  return `gpm_${randomBytes(16).toString("base64url")}`;
}

interface OperatorRunRow {
  id: string;
  label: string;
  game: string;
  status: string;
  opened_at: Date;
  closes_at: Date | null;
}

async function findOperatorRun(token: string) {
  const rows = await query<OperatorRunRow>(
    `select run.id, entrance.label, entrance.game, run.status, run.opened_at, run.closes_at
     from game_pool_runs run
     join game_pool_entrances entrance on entrance.id = run.entrance_id
     where run.operator_token_hash = $1
     limit 1`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function getGamePoolOperatorView(token: string): Promise<GamePoolOperatorView> {
  const run = await findOperatorRun(token);
  if (!run || !isGamePoolGame(run.game))
    return { found: false, message: "This organizer link is not valid." };
  const rooms = await query<{
    room_id: string;
    status: string;
    player_count: number;
    capacity: number;
    created_at: Date;
  }>(
    `select room_id, status, player_count, capacity, created_at
     from game_pool_rooms where run_id = $1 order by created_at`,
    [run.id],
  );
  return {
    found: true,
    label: run.label,
    game: run.game,
    runId: run.id,
    status: run.status as GamePoolRunStatus,
    openedAt: run.opened_at.toISOString(),
    closesAt: run.closes_at?.toISOString() ?? null,
    rooms: rooms.map(
      (room, index): GamePoolRoomSummary => ({
        roomId: room.room_id,
        label: `room ${index + 1}`,
        status: room.status === "open" ? "open" : room.status === "closed" ? "closed" : "started",
        playerCount: room.player_count,
        capacity: room.capacity,
        occupants: [],
        createdAt: room.created_at.toISOString(),
      }),
    ),
  };
}

export async function controlGamePoolAsOperator(
  token: string,
  action: "pause" | "resume" | "close" | "close-room",
  roomId?: string,
) {
  const tokenDigest = hashToken(token);
  const runId = await transaction(async (client) => {
    const result = await client.query<{ id: string; status: string }>(
      `select id, status from game_pool_runs where operator_token_hash = $1 for update`,
      [tokenDigest],
    );
    const run = result.rows[0];
    if (!run) throw new Error("This organizer link is not valid.");
    if (action === "close-room") {
      if (!roomId) throw new Error("Choose a room.");
      await client.query(
        `update game_pool_rooms set status = 'closed', updated_at = now()
         where run_id = $1 and room_id = $2`,
        [run.id, roomId],
      );
      await client.query(
        `insert into game_pool_moderation_events
         (id, run_id, room_id, action_id, actor, action)
         values ($1, $2, $3, $4, 'pool_operator', 'room_closed')
         on conflict (run_id, action_id) do nothing`,
        [moderationId(), run.id, roomId, `operator-close-room:${roomId}`],
      );
    } else {
      const status: GamePoolRunStatus =
        action === "pause" ? "paused" : action === "resume" ? "open" : "closed";
      if (run.status !== "closed")
        await client.query(
          `update game_pool_runs set status = $2,
             closed_at = case when $2 = 'closed' then now() else null end,
             updated_at = now()
           where id = $1`,
          [run.id, status],
        );
    }
    return run.id;
  });
  await publishMultiplayerRoomWake("game-pool", runId).catch(() => undefined);
  if (action === "close")
    await publishMultiplayerRoomTermination("game-pool", runId, {
      reason: "session_ended",
    }).catch(() => undefined);
  return getGamePoolOperatorView(token);
}
