export interface DurableWorkSnapshot {
  available: boolean;
  pending: number;
  processing: number;
  failed: number;
  oldestPendingAt: string | null;
}

export const DURABLE_WORK_LOG_SCOPE = {
  email: "durable_work.email",
  media: "durable_work.media",
  officialGameResults: "durable_work.official_game_results",
} as const;

export function durableWorkSnapshot(input: DurableWorkSnapshot): DurableWorkSnapshot {
  return input;
}

export function durableWorkBacklogAgeMs(
  snapshot: DurableWorkSnapshot,
  now = Date.now(),
): number | null {
  if (!snapshot.oldestPendingAt) return null;
  const oldest = Date.parse(snapshot.oldestPendingAt);
  return Number.isFinite(oldest) ? Math.max(0, now - oldest) : null;
}
