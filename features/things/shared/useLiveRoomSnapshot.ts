import { useCallback, useEffect, useRef, useState } from "react";
import { recordDiagnosticAction } from "@/features/reports/diagnostics";
import { resolveLiveRoomRead, shouldApplyLiveRoomSnapshot } from "./live-room-state";
import { useRoomReconciler } from "./useRoomReconciler";

export interface LiveRoomSnapshotBase {
  sequence: number;
  serverNow: number;
  /** What the server hashed this view to. Absent on games that have not adopted the digest. */
  digest?: string;
}

type LiveRoomSnapshotResult<Snapshot> =
  | { ok: true; snapshot: Snapshot }
  | { ok: true; unchanged: true; serverNow: number }
  | { ok: false; error: string };

interface LiveRoomSnapshotInput<Snapshot extends LiveRoomSnapshotBase> {
  enabled?: boolean;
  intervalMs: number;
  /** Identity of the room and viewer; changing it restarts polling from scratch. */
  roomKey: string | null;
  initialSnapshot?: Snapshot;
  /**
   * `lastDigest` is what the viewer already holds. A room whose read honours it answers unchanged
   * polls with a few bytes instead of a few kilobytes; one that ignores it simply keeps sending
   * whole snapshots, so adopting this is per game and never a breaking change.
   */
  read: (
    lastSequence: number,
    lastDigest: string | null,
  ) => Promise<LiveRoomSnapshotResult<Snapshot>>;
  /** Scheduled moments the room changes on its own, so the next read lands just after one. */
  boundariesOf?: (snapshot: Snapshot) => Array<number | null | undefined>;
}

/**
 * Shared live-room state for the multiplayer games: polls a snapshot, keeps a server clock offset,
 * coalesces socket wakes with the safety poll, and re-reads itself the moment a round boundary
 * passes. Callers own their own wake socket and pass `refresh` to it.
 */
export function useLiveRoomSnapshot<Snapshot extends LiveRoomSnapshotBase>(
  input: LiveRoomSnapshotInput<Snapshot>,
) {
  const [snapshot, setSnapshotState] = useState<Snapshot | null>(input.initialSnapshot ?? null);
  const [clockOffset, setClockOffset] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const sequenceRef = useRef(input.initialSnapshot?.sequence ?? 0);
  const digestRef = useRef<string | null>(input.initialSnapshot?.digest ?? null);
  const failuresRef = useRef(0);
  const readRef = useRef(input.read);
  const boundariesRef = useRef(input.boundariesOf);
  const initialSnapshotRef = useRef(input.initialSnapshot);
  const roomKeyRef = useRef(input.roomKey);
  useEffect(() => {
    readRef.current = input.read;
    boundariesRef.current = input.boundariesOf;
    initialSnapshotRef.current = input.initialSnapshot;
  });

  // A fresh room or viewer starts with a clean failure count, otherwise a previous room's blips
  // would count towards ending this one.
  useEffect(() => {
    roomKeyRef.current = input.roomKey;
    const initialSnapshot = input.roomKey ? (initialSnapshotRef.current ?? null) : null;
    failuresRef.current = 0;
    sequenceRef.current = initialSnapshot?.sequence ?? 0;
    digestRef.current = initialSnapshot?.digest ?? null;
    setClockOffset(0);
    setMessage(null);
    setEnded(false);
    setSnapshotState(initialSnapshot);
  }, [input.roomKey]);

  const setSnapshot = useCallback(
    (nextSnapshot: Snapshot | null) => {
      // A response belonging to the previous room must not populate the next room if route props
      // change while that request is still in flight.
      if (roomKeyRef.current !== input.roomKey) return false;
      if (nextSnapshot && !shouldApplyLiveRoomSnapshot(sequenceRef.current, nextSnapshot.sequence))
        return false;
      sequenceRef.current = nextSnapshot?.sequence ?? 0;
      digestRef.current = nextSnapshot?.digest ?? null;
      setSnapshotState(nextSnapshot);
      return true;
    },
    [input.roomKey],
  );

  const reconcile = useCallback(
    async (isCurrent: () => boolean) => {
      const startedAt = Date.now();
      let read: Parameters<typeof resolveLiveRoomRead<Snapshot>>[0];
      try {
        read = await readRef.current(sequenceRef.current, digestRef.current);
      } catch {
        // A request that never landed — offline tab, timeout, busy room — says nothing about whether
        // the room still exists.
        read = { ok: false, unreachable: true };
      }
      const endedAt = Date.now();
      if (!isCurrent()) return;

      const outcome = resolveLiveRoomRead(read, failuresRef.current);
      failuresRef.current = outcome.consecutiveFailures;
      if (!read.ok) {
        recordDiagnosticAction(
          "unreachable" in read ? "room.read.unreachable" : "room.read.unavailable",
          {
            failures: outcome.consecutiveFailures,
            ended: outcome.ended,
          },
        );
      }
      setMessage(outcome.message);
      setEnded(outcome.ended);
      // Nothing to apply, but the clock still gets a free correction out of the round trip.
      if (read.ok && "unchanged" in read) {
        setClockOffset(read.serverNow - (startedAt + endedAt) / 2);
        return;
      }

      if (outcome.snapshot === undefined) return;
      if (outcome.snapshot === null) {
        setSnapshot(null);
        return;
      }
      setClockOffset(outcome.snapshot.serverNow - (startedAt + endedAt) / 2);
      setSnapshot(outcome.snapshot);
    },
    [setSnapshot],
  );

  const refresh = useRoomReconciler({
    enabled: (input.enabled ?? true) && Boolean(input.roomKey) && !ended,
    intervalMs: input.intervalMs,
    roomKey: input.roomKey,
    reconcile,
  });

  useEffect(() => {
    if (!snapshot) return;
    const now = Date.now() + clockOffset;
    const boundary = (boundariesRef.current?.(snapshot) ?? [])
      .filter((time): time is number => typeof time === "number" && time > now + 20)
      .toSorted((first, second) => first - second)[0];
    if (!boundary) return;
    // setTimeout overflows past a 32-bit delay and would fire immediately, over and over.
    const timer = window.setTimeout(
      () => void refresh(),
      Math.min(2_147_000_000, boundary - now + 80),
    );
    return () => window.clearTimeout(timer);
  }, [clockOffset, refresh, snapshot]);

  return {
    snapshot,
    setSnapshot,
    clockOffset,
    ended,
    message,
    setMessage,
    refresh,
    sequenceRef,
  };
}
