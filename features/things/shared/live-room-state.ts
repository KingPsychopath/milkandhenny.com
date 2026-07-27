/**
 * A room read only ever reports `room_unavailable`, which covers both a room that has genuinely
 * expired and a momentary blip — a Redis hiccup, a dropped request, a server restart mid-deploy.
 * Ending the session on the first one strands players in a live game with no way back, because the
 * poller and the wake socket both shut down with it. Several consecutive failures are required
 * instead, so a real ending still lands within a few seconds while a blip costs nothing.
 */
export const UNAVAILABLE_READS_BEFORE_ENDING = 3;

export const RECONNECTING_MESSAGE = "Reconnecting…";

export type LiveRoomRead<Snapshot> =
  | { ok: true; snapshot: Snapshot }
  /** The server answered, and the answer was that the room is not available. */
  | { ok: false; error: string }
  /** The request never completed: offline, timed out, or the room was busy. Always transient. */
  | { ok: false; unreachable: true };

export interface LiveRoomOutcome<Snapshot> {
  consecutiveFailures: number;
  ended: boolean;
  message: string | null;
  /** Absent when the outcome leaves the previous snapshot in place. */
  snapshot?: Snapshot | null;
}

/**
 * Fold one room read into the viewer's session state. Kept separate from the hook so the recovery
 * rules can be exercised directly.
 */
export function resolveLiveRoomRead<Snapshot>(
  read: LiveRoomRead<Snapshot>,
  consecutiveFailures: number,
): LiveRoomOutcome<Snapshot> {
  if (read.ok)
    return { consecutiveFailures: 0, ended: false, message: null, snapshot: read.snapshot };

  // A request that never landed says nothing about whether the room still exists, so it must not
  // count towards ending the session — an offline tab would otherwise eject itself.
  if ("unreachable" in read)
    return { consecutiveFailures, ended: false, message: RECONNECTING_MESSAGE };

  const failures = consecutiveFailures + 1;
  if (failures < UNAVAILABLE_READS_BEFORE_ENDING)
    return { consecutiveFailures: failures, ended: false, message: RECONNECTING_MESSAGE };
  return { consecutiveFailures: failures, ended: true, message: read.error, snapshot: null };
}
