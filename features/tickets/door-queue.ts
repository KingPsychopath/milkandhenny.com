/**
 * Offline door state.
 *
 * Pure reducer so the behaviour that matters at a door — admit once, reject
 * anything not on the manifest, replay cleanly when the signal comes back —
 * is testable without a browser or a camera.
 *
 * The manifest holds truncated hashes rather than ticket ids, so a device
 * left in a taxi cannot be turned into a ticket forgery kit.
 */

export type QueuedRedemption = {
  ticketId: string;
  scannedAt: string;
};

export type DoorOfflineState = {
  /** Truncated SHA-256 hashes of valid ticket ids, from the server. */
  manifest: readonly string[];
  /** Hashes admitted on this device while offline. */
  admitted: readonly string[];
  /** Redemptions awaiting sync, oldest first. */
  queue: readonly QueuedRedemption[];
};

export type OfflineScanOutcome =
  | { result: "admitted-offline"; state: DoorOfflineState }
  | { result: "already-redeemed-offline"; state: DoorOfflineState; scannedAt: string }
  | { result: "not-on-manifest"; state: DoorOfflineState };

export const EMPTY_DOOR_STATE: DoorOfflineState = { manifest: [], admitted: [], queue: [] };

const MANIFEST_HASH_PATTERN = /^[a-f0-9]{24}$/;
const TICKET_REFERENCE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{16}$/;
const MAX_OFFLINE_ADMISSIONS = 5_000;

/**
 * Restore the reload-safe part of a door shift. The manifest always comes from the current server
 * response; only admissions and unsynced work are trusted from session storage.
 */
export function restoreDoorOfflineState(
  manifest: readonly string[],
  stored: unknown,
): DoorOfflineState {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return { ...EMPTY_DOOR_STATE, manifest };
  }
  const value = stored as { admitted?: unknown; queue?: unknown };
  const admitted = Array.isArray(value.admitted)
    ? [
        ...new Set(
          value.admitted
            .filter(
              (entry): entry is string =>
                typeof entry === "string" && MANIFEST_HASH_PATTERN.test(entry),
            )
            .slice(-MAX_OFFLINE_ADMISSIONS),
        ),
      ]
    : [];
  const queue: QueuedRedemption[] = [];
  const queued = new Set<string>();
  if (Array.isArray(value.queue)) {
    for (const entry of value.queue.slice(-MAX_OFFLINE_ADMISSIONS)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const candidate = entry as { ticketId?: unknown; scannedAt?: unknown };
      if (
        typeof candidate.ticketId !== "string" ||
        !TICKET_REFERENCE_PATTERN.test(candidate.ticketId) ||
        typeof candidate.scannedAt !== "string" ||
        !Number.isFinite(Date.parse(candidate.scannedAt)) ||
        queued.has(candidate.ticketId)
      )
        continue;
      queued.add(candidate.ticketId);
      queue.push({ ticketId: candidate.ticketId, scannedAt: candidate.scannedAt });
    }
  }
  return { manifest, admitted, queue };
}

/**
 * Decide an offline scan.
 *
 * A ticket whose hash is absent from the manifest is refused rather than
 * waved through: the manifest is downloaded when the door opens, so absence
 * means the ticket was not valid at that point.
 */
export function recordOfflineScan(
  state: DoorOfflineState,
  input: { ticketId: string; ticketHash: string; scannedAt: string },
): OfflineScanOutcome {
  if (!state.manifest.includes(input.ticketHash)) {
    return { result: "not-on-manifest", state };
  }

  if (state.admitted.includes(input.ticketHash)) {
    const existing = state.queue.find((entry) => entry.ticketId === input.ticketId);
    return {
      result: "already-redeemed-offline",
      state,
      scannedAt: existing?.scannedAt ?? input.scannedAt,
    };
  }

  return {
    result: "admitted-offline",
    state: {
      manifest: state.manifest,
      admitted: [...state.admitted, input.ticketHash],
      queue: [...state.queue, { ticketId: input.ticketId, scannedAt: input.scannedAt }],
    },
  };
}

/** Drop entries the server has now accepted, preserving anything still pending. */
export function clearSynced(
  state: DoorOfflineState,
  syncedTicketIds: readonly string[],
): DoorOfflineState {
  const synced = new Set(syncedTicketIds);
  return {
    ...state,
    queue: state.queue.filter((entry) => !synced.has(entry.ticketId)),
  };
}

/**
 * Replace the manifest after a refresh.
 *
 * Offline admissions are kept even if the incoming manifest no longer lists
 * them: those people are already inside, and forgetting that would let the
 * same ticket admit twice.
 */
export function applyManifest(
  state: DoorOfflineState,
  manifest: readonly string[],
): DoorOfflineState {
  return { ...state, manifest };
}

export function pendingCount(state: DoorOfflineState): number {
  return state.queue.length;
}
