import { reconcileCommands, type ClientCommand, type ClientCommandState } from "./types";

export type ScoreSnapshot = {
  eventSlug: string;
  participantId: string;
  balance: number;
  revision: number;
  synchronizedAt: string;
};

export type PendingScoreCommand = ClientCommand & {
  eventSlug: string;
  participantId: string;
  payload: Record<string, unknown>;
  attempts: number;
  lastError?: string;
};

export function makeScoreCommand(input: {
  eventSlug: string;
  participantId: string;
  payload: Record<string, unknown>;
  localSequence: number;
}): PendingScoreCommand {
  return {
    id: crypto.randomUUID(),
    state: "pending",
    localSequence: input.localSequence,
    eventSlug: input.eventSlug,
    participantId: input.participantId,
    payload: input.payload,
    attempts: 0,
  };
}

export function reconcileSnapshot(
  current: ScoreSnapshot | undefined,
  incoming: ScoreSnapshot,
): ScoreSnapshot {
  if (!current || incoming.revision >= current.revision) return incoming;
  return current;
}

export function reconcilePendingCommands(
  commands: readonly PendingScoreCommand[],
  acknowledged: ReadonlyMap<string, ClientCommandState>,
): PendingScoreCommand[] {
  return reconcileCommands(commands, acknowledged) as PendingScoreCommand[];
}

export function shouldRetryScoreResponse(
  status: number | undefined,
  attempts: number,
  maxAttempts = 5,
): boolean {
  if (attempts >= maxAttempts) return false;
  return status === undefined || status >= 500;
}

export function nextRetryDelayMs(attempts: number, random = Math.random()): number {
  const base = Math.min(30_000, 500 * 2 ** Math.max(0, attempts));
  return Math.round(base * (0.75 + Math.min(0.5, Math.max(0, random))));
}

export class MinimumFetchGap {
  private lastFetchAt = 0;

  constructor(private readonly minimumGapMs: number) {}

  canFetch(now = Date.now()): boolean {
    return now - this.lastFetchAt >= this.minimumGapMs;
  }

  markFetched(now = Date.now()): void {
    this.lastFetchAt = now;
  }
}
