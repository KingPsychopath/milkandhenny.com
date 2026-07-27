import { useCallback, useEffect, useRef, useState } from "react";
import { resolveLiveRoomRead } from "./live-room-state";
import { useRoomReconciler } from "./useRoomReconciler";

export interface LiveRoomSnapshotBase {
  sequence: number;
  serverNow: number;
}

type LiveRoomSnapshotResult<Snapshot> =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; error: string };

interface LiveRoomSnapshotInput<Snapshot extends LiveRoomSnapshotBase> {
  enabled?: boolean;
  intervalMs: number;
  /** Identity of the room and viewer; changing it restarts polling from scratch. */
  roomKey: string | null;
  initialSnapshot?: Snapshot;
  read: (lastSequence: number) => Promise<LiveRoomSnapshotResult<Snapshot>>;
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
  const [snapshot, setSnapshot] = useState<Snapshot | null>(input.initialSnapshot ?? null);
  const [clockOffset, setClockOffset] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const sequenceRef = useRef(input.initialSnapshot?.sequence ?? 0);
  const failuresRef = useRef(0);
  const readRef = useRef(input.read);
  const boundariesRef = useRef(input.boundariesOf);
  useEffect(() => {
    readRef.current = input.read;
    boundariesRef.current = input.boundariesOf;
  });

  // A fresh room or viewer starts with a clean failure count, otherwise a previous room's blips
  // would count towards ending this one.
  useEffect(() => {
    failuresRef.current = 0;
  }, [input.roomKey]);

  const reconcile = useCallback(async (isCurrent: () => boolean) => {
    const startedAt = Date.now();
    let read: Parameters<typeof resolveLiveRoomRead<Snapshot>>[0];
    try {
      read = await readRef.current(sequenceRef.current);
    } catch {
      // A request that never landed — offline tab, timeout, busy room — says nothing about whether
      // the room still exists.
      read = { ok: false, unreachable: true };
    }
    const endedAt = Date.now();
    if (!isCurrent()) return;

    const outcome = resolveLiveRoomRead(read, failuresRef.current);
    failuresRef.current = outcome.consecutiveFailures;
    setMessage(outcome.message);
    setEnded(outcome.ended);
    if (outcome.snapshot === undefined) return;
    if (outcome.snapshot === null) {
      setSnapshot(null);
      return;
    }
    sequenceRef.current = outcome.snapshot.sequence;
    setClockOffset(outcome.snapshot.serverNow - (startedAt + endedAt) / 2);
    setSnapshot(outcome.snapshot);
  }, []);

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
