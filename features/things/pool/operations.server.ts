import { randomBytes } from "node:crypto";

import { query, transaction } from "@/lib/platform/postgres-provider-context.server";
import { clearAssignmentReceipts, expireStaleGamePoolAssignments } from "./membership.server";

let allocationAttempts = 0;
let allocationFailures = 0;
let allocationContention = 0;
let allocationDurationTotalMs = 0;
let allocationDurationMaxMs = 0;

export function recordGamePoolAllocation(input: {
  durationMs: number;
  failed: boolean;
  contended?: boolean;
}) {
  allocationAttempts += 1;
  if (input.failed) allocationFailures += 1;
  if (input.contended) allocationContention += 1;
  allocationDurationTotalMs += Math.max(0, input.durationMs);
  allocationDurationMaxMs = Math.max(allocationDurationMaxMs, input.durationMs);
}

export function recordGamePoolAllocationContention() {
  allocationContention += 1;
}

export async function describeGamePoolOperations() {
  const [counts] = await query<{
    active_assignments: string;
    open_rooms: string;
    open_runs: string;
  }>(
    `select
       (select count(*) from game_pool_assignments where status = 'active') as active_assignments,
       (select count(*) from game_pool_rooms where status = 'open') as open_rooms,
       (select count(*) from game_pool_runs
        where status in ('open', 'paused') and (closes_at is null or closes_at > now())) as open_runs`,
  );
  return {
    allocation: {
      attempts: allocationAttempts,
      failures: allocationFailures,
      contention: allocationContention,
      averageMs:
        allocationAttempts === 0
          ? null
          : Math.round((allocationDurationTotalMs / allocationAttempts) * 10) / 10,
      maxMs: allocationAttempts === 0 ? null : Math.round(allocationDurationMaxMs * 10) / 10,
    },
    activeAssignments: Number(counts?.active_assignments ?? 0),
    openRooms: Number(counts?.open_rooms ?? 0),
    openRuns: Number(counts?.open_runs ?? 0),
  };
}

export async function cleanupGamePools() {
  const result = await transaction(async (client) => {
    const dueEntrances = await client.query<{
      id: string;
      event_slug: string | null;
      preset: unknown;
      target_size: number;
      auto_join: boolean;
      allow_room_choice: boolean;
      allow_new_rooms: boolean;
      name_visibility: string;
      scheduled_open_at: Date;
      scheduled_close_at: Date;
    }>(
      `select entrance.id, inherited.event_slug, entrance.preset, entrance.target_size,
              entrance.auto_join, entrance.allow_room_choice, entrance.allow_new_rooms,
              entrance.name_visibility,
              coalesce(entrance.scheduled_open_at, inherited.games_open_at) as scheduled_open_at,
              coalesce(entrance.scheduled_close_at, inherited.games_close_at) as scheduled_close_at
         from game_pool_entrances entrance
         left join lateral (
           select register.event_slug, settings.games_open_at, settings.games_close_at
             from event_game_register register
             join event_scoring_settings settings on settings.event_slug = register.event_slug
            where register.pool_entrance_id = entrance.id
              and register.status = 'included' and register.play_mode = 'pooled'
            order by settings.games_open_at desc nulls last, register.event_slug
            limit 1
         ) inherited on true
        where entrance.retired_at is null
          and coalesce(entrance.scheduled_open_at, inherited.games_open_at) is not null
          and coalesce(entrance.scheduled_open_at, inherited.games_open_at) <= now()
          and coalesce(entrance.scheduled_close_at, inherited.games_close_at) is not null
          and coalesce(entrance.scheduled_close_at, inherited.games_close_at)
              > coalesce(entrance.scheduled_open_at, inherited.games_open_at)
        order by scheduled_open_at, entrance.id
        for update of entrance`,
    );
    let openedRuns = 0;
    for (const entrance of dueEntrances.rows) {
      const openingActionId = `scheduled:${entrance.event_slug ?? "entrance"}:${entrance.scheduled_open_at.toISOString()}`;
      const existing = await client.query(
        `select id from game_pool_runs
          where entrance_id = $1 and opening_action_id = $2`,
        [entrance.id, openingActionId],
      );
      if (existing.rows[0]) {
        await client.query(
          `update game_pool_runs set closes_at = $2, updated_at = now()
            where id = $1 and status in ('open', 'paused')`,
          [existing.rows[0].id, entrance.scheduled_close_at],
        );
        continue;
      }
      if (entrance.scheduled_close_at.getTime() <= Date.now()) continue;
      await client.query(
        `update game_pool_runs
            set status = 'closed', closed_at = coalesce(closed_at, now()), updated_at = now()
          where entrance_id = $1 and status in ('open', 'paused')`,
        [entrance.id],
      );
      await client.query(
        `insert into game_pool_runs (
           id, entrance_id, preset, target_size, auto_join, allow_room_choice,
           allow_new_rooms, name_visibility, opened_at, closes_at,
           operator_token_hash, opening_action_id
         ) values ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,now(),$9,$10,$11)`,
        [
          `gpr_${randomBytes(16).toString("base64url")}`,
          entrance.id,
          JSON.stringify(entrance.preset),
          entrance.target_size,
          entrance.auto_join,
          entrance.allow_room_choice,
          entrance.allow_new_rooms,
          entrance.name_visibility,
          entrance.scheduled_close_at,
          randomBytes(32).toString("hex"),
          openingActionId,
        ],
      );
      openedRuns += 1;
    }
    const closedRuns = await client.query(
      `update game_pool_runs
       set status = 'closed', closed_at = coalesce(closed_at, now()), updated_at = now()
       where status in ('open', 'paused') and closes_at is not null and closes_at <= now()`,
    );
    const poolMemberships = await expireStaleGamePoolAssignments(client);
    const redactedAssignments = await client.query(
      `update game_pool_assignments
       set display_name = status
       where status <> 'active' and ended_at < now() - interval '7 days'
         and display_name <> status`,
    );
    const deletedMetadata = await client.query(
      `delete from game_pool_moderation_events
       where created_at < now() - interval '180 days'`,
    );
    return {
      openedRuns,
      closedRuns: closedRuns.rowCount ?? 0,
      staleAssignments: poolMemberships.staleAssignments,
      closedRooms: poolMemberships.closedRooms,
      redactedAssignments: redactedAssignments.rowCount ?? 0,
      deletedMetadata: deletedMetadata.rowCount ?? 0,
      staleReceipts: poolMemberships.receipts,
    };
  });
  const { staleReceipts, ...summary } = result;
  await clearAssignmentReceipts(staleReceipts);
  return summary;
}
