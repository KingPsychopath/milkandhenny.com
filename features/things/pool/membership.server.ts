import { randomBytes } from "node:crypto";
import { getRedis } from "@/lib/platform/redis.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import { gamePoolAssignmentReceiptKey } from "./pool-keys";

function moderationId() {
  return `gpm_${randomBytes(16).toString("base64url")}`;
}

async function clearAssignmentReceipts(receipts: Array<{ runId: string; clientId: string }>) {
  const redis = getRedis();
  if (redis && receipts.length > 0)
    await redis.del(
      ...receipts.map(({ runId, clientId }) => gamePoolAssignmentReceiptKey(runId, clientId)),
    );
}

export async function markGamePoolPlayerLeft(input: { roomId: string; playerId: string }) {
  const operation = await transaction(async (client) => {
    const rows = await client.query<{ client_id: string; run_id: string }>(
      `update game_pool_assignments
       set status = 'left', ended_at = now(), display_name = 'left'
       where room_id = $1 and player_id = $2 and status = 'active'
       returning run_id, client_id`,
      [input.roomId, input.playerId],
    );
    for (const row of rows.rows)
      await client.query(
        `update game_pool_rooms set player_count = greatest(0, player_count - 1), updated_at = now()
         where run_id = $1 and room_id = $2`,
        [row.run_id, input.roomId],
      );
    return rows.rows.map(({ run_id, client_id }) => ({ runId: run_id, clientId: client_id }));
  });
  await clearAssignmentReceipts(operation);
  return { released: operation.length };
}

export async function markGamePoolPlayersRemoved(input: {
  roomId: string;
  playerIds: string[];
  actionId: string;
}) {
  const playerIds = [...new Set(input.playerIds)].filter(Boolean);
  if (playerIds.length === 0) return { removed: 0 };
  const operation = transaction(async (client) => {
    const rows = await client.query<{
      id: string;
      client_id: string;
      run_id: string;
      room_id: string;
    }>(
      `update game_pool_assignments
       set status = 'removed', ended_at = now(), display_name = 'removed'
       where room_id = $1 and player_id = any($2::text[]) and status = 'active'
       returning id, run_id, room_id, client_id`,
      [input.roomId, playerIds],
    );
    for (const row of rows.rows) {
      await client.query(
        `update game_pool_rooms set
           player_count = greatest(0, player_count - 1),
           status = case when player_count <= 1 then 'closed' else status end,
           updated_at = now()
         where run_id = $1 and room_id = $2`,
        [row.run_id, row.room_id],
      );
      await client.query(
        `insert into game_pool_moderation_events
         (id, run_id, room_id, assignment_id, action_id, actor, action)
         values ($1, $2, $3, $4, $5, 'room_lead', 'player_removed')
         on conflict (run_id, action_id) do nothing`,
        [moderationId(), row.run_id, row.room_id, row.id, `${input.actionId}:${row.id}`],
      );
    }
    return {
      removed: rows.rowCount ?? rows.rows.length,
      receipts: rows.rows.map(({ run_id, client_id }) => ({ runId: run_id, clientId: client_id })),
    };
  });
  const result = await operation;
  await clearAssignmentReceipts(result.receipts);
  return { removed: result.removed };
}

export async function findGamePoolRunForClient(input: { token: string; clientId: string }) {
  const rows = await query<{ run_id: string }>(
    `select assignment.run_id
     from game_pool_assignments assignment
     join game_pool_runs run on run.id = assignment.run_id
     join game_pool_entrances entrance on entrance.id = run.entrance_id
     where entrance.token = $1 and assignment.client_id = $2 and assignment.status = 'active'
     order by assignment.created_at desc
     limit 1`,
    [input.token, input.clientId],
  );
  return rows[0]?.run_id ?? null;
}

export async function recentlyRemovedGamePoolRoom(input: { runId: string; clientId: string }) {
  const rows = await query<{ room_id: string }>(
    `select room_id from game_pool_assignments
     where run_id = $1 and client_id = $2 and status = 'removed'
     order by ended_at desc nulls last
     limit 1`,
    [input.runId, input.clientId],
  );
  return rows[0]?.room_id ?? null;
}
