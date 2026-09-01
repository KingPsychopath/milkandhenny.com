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
