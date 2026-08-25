import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { getRedis } from "@/lib/platform/redis.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import { gamePoolAssignmentReceiptKey } from "./pool-keys";

function moderationId() {
  return `gpm_${randomBytes(16).toString("base64url")}`;
}

export async function clearAssignmentReceipts(
  receipts: Array<{ runId: string; clientId: string }>,
) {
  const redis = getRedis();
  if (redis && receipts.length > 0)
    await redis.del(
      ...receipts.map(({ runId, clientId }) => gamePoolAssignmentReceiptKey(runId, clientId)),
    );
}

export async function expireStaleGamePoolAssignments(
  client: PoolClient,
  runId?: string,
): Promise<{
  staleAssignments: number;
  closedRooms: number;
  receipts: Array<{ runId: string; clientId: string }>;
}> {
  const sweepAt = new Date();
  const runFilter = runId ? "and assignment.run_id = $2" : "";
  const staleAssignments = await client.query<{
    run_id: string;
    room_id: string;
    client_id: string;
  }>(
    `update game_pool_assignments assignment
     set status = 'session_ended', ended_at = $1, display_name = 'session_ended'
     where assignment.status = 'active'
       and assignment.last_seen_at < now() - interval '90 seconds'
       ${runFilter}
     returning run_id, room_id, client_id`,
    runId ? [sweepAt, runId] : [sweepAt],
  );

  const closedRooms = await client.query(
    `update game_pool_rooms room
     set player_count = case when live.active_count > 0 then live.active_count else 0 end,
         status = case when live.active_count > 0 then room.status else 'closed' end,
         updated_at = now()
     from (
       select room_id, run_id, count(*)::int as active_count
       from game_pool_assignments
       where status = 'active'
       group by run_id, room_id
     ) live
     where room.status <> 'closed'
       and room.run_id = live.run_id
       and room.room_id = live.room_id
       and room.player_count <> live.active_count
       ${runId ? "and room.run_id = $1" : ""}`,
    runId ? [runId] : [],
  );

  const emptyRooms = await client.query(
    `update game_pool_rooms room
     set status = 'closed', player_count = 0, updated_at = now()
     where room.status <> 'closed'
       and not exists (
         select 1 from game_pool_assignments assignment
         where assignment.run_id = room.run_id and assignment.room_id = room.room_id
           and assignment.status = 'active'
       )
       ${runId ? "and room.run_id = $1" : ""}`,
    runId ? [runId] : [],
  );

  return {
    staleAssignments: staleAssignments.rowCount ?? staleAssignments.rows.length,
    closedRooms: (closedRooms.rowCount ?? 0) + (emptyRooms.rowCount ?? 0),
    receipts: staleAssignments.rows.map(({ run_id, client_id }) => ({
      runId: run_id,
      clientId: client_id,
    })),
  };
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

/**
 * The SQL guard below already refuses to touch a row seen in the last 30
 * seconds, but the query itself still round-trips on every snapshot poll —
 * for standalone rooms with no assignment row at all, too. This mirror of
 * that window keeps the read path free of Postgres between heartbeats.
 */
const SEEN_THROTTLE_MS = 30_000;
const lastSeenAttempts = new Map<string, number>();

/** Keep a pool assignment alive while its room client is still polling. */
export async function markGamePoolPlayerSeen(input: { roomId: string; playerId: string }) {
  const key = `${input.roomId}:${input.playerId}`;
  const now = Date.now();
  const last = lastSeenAttempts.get(key);
  if (last !== undefined && now - last < SEEN_THROTTLE_MS) return;
  lastSeenAttempts.set(key, now);
  if (lastSeenAttempts.size > 10_000) {
    for (const [candidate, at] of lastSeenAttempts) {
      if (now - at >= SEEN_THROTTLE_MS) lastSeenAttempts.delete(candidate);
    }
  }
  await query(
    `update game_pool_assignments
     set last_seen_at = now()
     where room_id = $1 and player_id = $2 and status = 'active'
       and last_seen_at < now() - interval '30 seconds'`,
    [input.roomId, input.playerId],
  );
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
