import { useCallback, useEffect, useRef, useState } from "react";
import { useMultiplayerWakeSocket } from "../shared/useMultiplayerWakeSocket";
import { useRoomReconciler } from "../shared/useRoomReconciler";
import { readDrawCountrySnapshotFn } from "./draw-country-room.functions";
import type { DrawCountrySnapshot } from "./types";

export function useDrawCountryRoom(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
  initialSnapshot?: DrawCountrySnapshot;
}) {
  const [snapshot, setSnapshot] = useState<DrawCountrySnapshot | null>(
    input.initialSnapshot ?? null,
  );
  const [clockOffset, setClockOffset] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const sequenceRef = useRef(input.initialSnapshot?.sequence ?? 0);

  const reconcile = useCallback(
    async (isCurrent: () => boolean) => {
      const startedAt = Date.now();
      try {
        const result = await readDrawCountrySnapshotFn({
          data: {
            roomId: input.roomId,
            playerId: input.playerId,
            playerToken: input.playerToken,
          },
        });
        const endedAt = Date.now();
        if (!isCurrent()) return;
        if (!result.ok) {
          setEnded(true);
          setSnapshot(null);
          setMessage(result.error);
          return;
        }
        sequenceRef.current = result.snapshot.sequence;
        setClockOffset(result.snapshot.serverNow - (startedAt + endedAt) / 2);
        setSnapshot(result.snapshot);
        setEnded(false);
        setMessage(null);
      } catch {
        if (isCurrent()) setMessage("Reconnecting…");
      }
    },
    [input.playerId, input.playerToken, input.roomId],
  );

  const refresh = useRoomReconciler({
    enabled: !ended,
    intervalMs: 8_000,
    roomKey: `${input.roomId}:${input.playerId}:${input.playerToken}`,
    reconcile,
  });
  const socket = useMultiplayerWakeSocket({
    path: "/api/things/draw-country-ws",
    hello: ended
      ? null
      : {
          roomId: input.roomId,
          playerId: input.playerId,
          playerToken: input.playerToken,
        },
    onWake: () => void refresh(),
  });

  useEffect(() => {
    const round = snapshot?.round;
    if (!round) return;
    const now = Date.now() + clockOffset;
    const boundary = [round.startsAt, round.endsAt, round.nextRoundAt]
      .filter((time): time is number => time !== null && time > now + 20)
      .sort((a, b) => a - b)[0];
    if (!boundary) return;
    const timer = window.setTimeout(() => void refresh(), boundary - now + 80);
    return () => window.clearTimeout(timer);
  }, [clockOffset, refresh, snapshot?.phase, snapshot?.round]);

  return {
    snapshot,
    setSnapshot,
    clockOffset,
    connectionState: socket.state,
    notify: socket.notify,
    refresh,
    ended,
    message,
    setMessage,
  };
}
