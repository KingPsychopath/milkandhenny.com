import { createScoreRequestDeadline, type PendingScoreCommand } from "./client-sync";
import { EventScoringClientStore } from "./client-sync-store";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;
const CLAIM_PATH = /^\/api\/events\/[A-Za-z0-9_-]+\//;
const CLAIM_LEASE_MS = 15_000;

export const ATTENDEE_CLAIMS_EVENT = "mah-attendee-claims";

type AttendeeClaimPayload = {
  kind: "attendee-claim";
  url: string;
  body: Record<string, unknown>;
  label: string;
  ticketId?: string;
  expiresAt?: string;
  nextAttemptAt: number;
};

export type AttendeeClaimResult =
  | { state: "accepted" | "held"; body: Record<string, unknown> }
  | { state: "rejected"; error: string; status?: number; body?: Record<string, unknown> }
  | { state: "pending"; error: string };

export type AttendeeClaimEventDetail = {
  commandId: string;
  eventSlug: string;
  participantId: string;
  ticketId?: string;
  result: AttendeeClaimResult;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function payloadOf(command: PendingScoreCommand): AttendeeClaimPayload | null {
  const payload = command.payload;
  if (
    payload.kind !== "attendee-claim" ||
    typeof payload.url !== "string" ||
    !CLAIM_PATH.test(payload.url) ||
    !isRecord(payload.body) ||
    typeof payload.label !== "string" ||
    typeof payload.nextAttemptAt !== "number"
  ) {
    return null;
  }
  return payload as AttendeeClaimPayload;
}

function announceChange(command?: PendingScoreCommand, result?: AttendeeClaimResult) {
  const payload = command ? payloadOf(command) : null;
  const detail =
    command && result
      ? ({
          commandId: command.id,
          eventSlug: command.eventSlug,
          participantId: command.participantId,
          ticketId: payload?.ticketId,
          result,
        } satisfies AttendeeClaimEventDetail)
      : undefined;
  window.dispatchEvent(new CustomEvent(ATTENDEE_CLAIMS_EVENT, { detail }));
}

export function attendeeClaimResultFromEvent(
  event: Event,
  commandId: string,
): AttendeeClaimEventDetail | undefined {
  const detail = (event as CustomEvent<unknown>).detail;
  if (!isRecord(detail) || detail.commandId !== commandId || !isRecord(detail.result)) return;
  const state = detail.result.state;
  if (state !== "accepted" && state !== "held" && state !== "rejected" && state !== "pending")
    return;
  return detail as AttendeeClaimEventDetail;
}

function backoff(attempts: number) {
  return Math.min(MAX_BACKOFF_MS, 750 * 2 ** Math.min(5, attempts));
}

function acquireClaimLease(commandId: string, owner: string) {
  const key = `mah-attendee-claim-sync:${commandId}`;
  try {
    const current = JSON.parse(localStorage.getItem(key) ?? "null") as {
      owner?: string;
      until?: number;
    } | null;
    if (typeof current?.until === "number" && current.until > Date.now()) return null;
    localStorage.setItem(key, JSON.stringify({ owner, until: Date.now() + CLAIM_LEASE_MS }));
    return () => {
      try {
        const lease = JSON.parse(localStorage.getItem(key) ?? "null") as { owner?: string } | null;
        if (lease?.owner === owner) localStorage.removeItem(key);
      } catch {
        // An expired lease is harmless; the server command remains idempotent.
      }
    };
  } catch {
    return () => undefined;
  }
}

async function perform(
  command: PendingScoreCommand,
  store: EventScoringClientStore,
): Promise<AttendeeClaimResult> {
  const payload = payloadOf(command);
  if (!payload) {
    await store.removeCommand(command.id);
    const result = { state: "rejected", error: "This saved claim could not be read" } as const;
    announceChange(command, result);
    return result;
  }
  if (command.attempts === 0 && payload.expiresAt && Date.parse(payload.expiresAt) <= Date.now()) {
    const expired = {
      ...command,
      state: "rejected" as const,
      lastError: `${payload.label} expired before it could be confirmed`,
    };
    await store.saveCommand(expired);
    const result = { state: "rejected", error: expired.lastError } as const;
    announceChange(command, result);
    return result;
  }

  const releaseLease = acquireClaimLease(command.id, crypto.randomUUID());
  if (!releaseLease) {
    return { state: "pending", error: `${payload.label} is already being confirmed` };
  }

  const deadline = createScoreRequestDeadline(REQUEST_TIMEOUT_MS);
  let response: Response | undefined;
  let body: Record<string, unknown> = {};
  try {
    response = await fetch(payload.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload.body),
      signal: deadline.signal,
    });
    const parsed: unknown = await response.json().catch(() => null);
    body = isRecord(parsed) ? parsed : {};
    if (response.ok) {
      await store.removeCommand(command.id);
      const result = { state: body.state === "held" ? "held" : "accepted", body } as const;
      announceChange(command, result);
      window.dispatchEvent(new Event("mah-score-wake"));
      return result;
    }
    const error = typeof body.error === "string" ? body.error : `${payload.label} was not accepted`;
    if (response.status < 500 && response.status !== 425) {
      if (command.attempts > 0) {
        await store.saveCommand({ ...command, state: "rejected", lastError: error });
      } else {
        await store.removeCommand(command.id);
      }
      const result = { state: "rejected", error, status: response.status, body } as const;
      announceChange(command, result);
      return result;
    }
    throw new Error(error);
  } catch (cause) {
    const attempts = command.attempts + 1;
    const error =
      cause instanceof Error && cause.name !== "AbortError"
        ? cause.message
        : `The result of ${payload.label.toLowerCase()} is not confirmed yet`;
    await store.saveCommand({
      ...command,
      attempts,
      lastError: error,
      payload: { ...payload, nextAttemptAt: Date.now() + backoff(attempts) },
    });
    const result = { state: "pending", error } as const;
    announceChange(command, result);
    return result;
  } finally {
    deadline.clear();
    releaseLease();
  }
}

export async function submitAttendeeClaim(input: {
  commandId: string;
  eventSlug: string;
  participantId: string;
  url: string;
  body: Record<string, unknown>;
  label: string;
  ticketId?: string;
  expiresAt?: string;
}): Promise<AttendeeClaimResult> {
  const store = new EventScoringClientStore();
  const command: PendingScoreCommand = {
    id: input.commandId,
    state: "pending",
    localSequence: Date.now(),
    eventSlug: input.eventSlug,
    participantId: input.participantId,
    attempts: 0,
    payload: {
      kind: "attendee-claim",
      url: input.url,
      body: input.body,
      label: input.label,
      ticketId: input.ticketId,
      expiresAt: input.expiresAt,
      nextAttemptAt: Date.now(),
    } satisfies AttendeeClaimPayload,
  };
  try {
    await store.saveCommand(command);
    return await perform(command, store);
  } finally {
    store.close();
  }
}

export async function reconcileAttendeeClaims(): Promise<void> {
  const store = new EventScoringClientStore();
  try {
    const commands = (await store.listAllCommands())
      .filter((command) => command.state === "pending")
      .filter(
        (command) => (payloadOf(command)?.nextAttemptAt ?? Number.POSITIVE_INFINITY) <= Date.now(),
      )
      .slice(0, 3);
    for (const command of commands) await perform(command, store);
  } finally {
    store.close();
  }
}

export async function attendeeClaimSummary(eventSlug: string, participantId: string) {
  const store = new EventScoringClientStore();
  try {
    const commands = await store.listCommands(eventSlug, participantId);
    return {
      pending: commands.filter((command) => command.state === "pending").length,
      rejected: commands.filter((command) => command.state === "rejected").length,
      rejectedReasons: commands
        .filter((command) => command.state === "rejected" && command.lastError)
        .map((command) => command.lastError!),
    };
  } finally {
    store.close();
  }
}

export async function dismissRejectedAttendeeClaims(eventSlug: string, participantId: string) {
  const store = new EventScoringClientStore();
  try {
    const commands = await store.listCommands(eventSlug, participantId);
    await Promise.all(
      commands
        .filter((command) => command.state === "rejected")
        .map((command) => store.removeCommand(command.id)),
    );
    announceChange();
  } finally {
    store.close();
  }
}
