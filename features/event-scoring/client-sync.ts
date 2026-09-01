import { reconcileCommands, type ClientCommand, type ClientCommandState } from "./types";
import type { TeamColourKey } from "./team-palette";

export type ScoreSnapshot = {
  eventSlug: string;
  participantId: string;
  balance: number;
  revision: number;
  synchronizedAt: string;
  orderPoints?: number;
  teamName?: string;
  teamColourKey?: TeamColourKey;
};

export type PendingScoreCommand = ClientCommand & {
  eventSlug: string;
  participantId: string;
  payload: Record<string, unknown>;
  attempts: number;
  lastError?: string;
};

const SCORE_SESSION_MARKER = "mah-has-score-session";
const SCORE_SESSION_LINKS = "mah-score-session-links";
export const SCORE_SESSION_EVENT = "mah-score-session";

export function rememberScoreSession(link?: { eventSlug: string; ticketId: string }): void {
  try {
    localStorage.setItem(SCORE_SESSION_MARKER, "1");
    if (link) {
      const links = rememberedScoreLinks().filter((entry) => entry.eventSlug !== link.eventSlug);
      localStorage.setItem(SCORE_SESSION_LINKS, JSON.stringify([...links, link]));
    }
    window.dispatchEvent(new CustomEvent(SCORE_SESSION_EVENT, { detail: link }));
  } catch {
    // Storage is an optimization; confirmed scores still refresh from the server.
  }
}

export function rememberedScoreLinks(): Array<{ eventSlug: string; ticketId: string }> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SCORE_SESSION_LINKS) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (link): link is { eventSlug: string; ticketId: string } =>
        Boolean(link) &&
        typeof link === "object" &&
        typeof (link as { eventSlug?: unknown }).eventSlug === "string" &&
        typeof (link as { ticketId?: unknown }).ticketId === "string",
    );
  } catch {
    return [];
  }
}

export function hasRememberedScoreSession(): boolean {
  try {
    return localStorage.getItem(SCORE_SESSION_MARKER) === "1";
  } catch {
    return false;
  }
}

export function createScoreRequestDeadline(timeoutMs: number): {
  signal: AbortSignal;
  abort: () => void;
  clear: () => void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  return {
    signal: controller.signal,
    abort: () => {
      clearTimeout(timeout);
      controller.abort();
    },
    clear: () => clearTimeout(timeout),
  };
}

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

export type ScoreSyncResponse = {
  participant: {
    id: string;
    balance: number;
    revision: number;
    lastTransactionAt?: string;
    teamName?: string;
    teamColourKey?: TeamColourKey;
  };
  orderPoints?: number;
};

export function scoreSnapshotFromResponse(
  eventSlug: string,
  response: ScoreSyncResponse,
  synchronizedAt = new Date().toISOString(),
): ScoreSnapshot {
  return {
    eventSlug,
    participantId: response.participant.id,
    balance: response.participant.balance,
    revision: response.participant.revision,
    synchronizedAt,
    orderPoints: response.orderPoints,
    teamName: response.participant.teamName,
    teamColourKey: response.participant.teamColourKey,
  };
}

export function isScoreSyncResponse(value: unknown): value is ScoreSyncResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const participant = (value as { participant?: unknown }).participant;
  if (!participant || typeof participant !== "object" || Array.isArray(participant)) return false;
  const record = participant as Record<string, unknown>;
  const orderPoints = (value as { orderPoints?: unknown }).orderPoints;
  const teamName = record.teamName;
  const teamColourKey = record.teamColourKey;
  return (
    typeof record.id === "string" &&
    typeof record.balance === "number" &&
    Number.isInteger(record.balance) &&
    typeof record.revision === "number" &&
    Number.isInteger(record.revision) &&
    record.revision >= 0 &&
    (teamName === undefined || typeof teamName === "string") &&
    (teamColourKey === undefined ||
      teamColourKey === "amber" ||
      teamColourKey === "sage" ||
      teamColourKey === "plum" ||
      teamColourKey === "sky") &&
    (orderPoints === undefined ||
      (typeof orderPoints === "number" && Number.isInteger(orderPoints)))
  );
}
