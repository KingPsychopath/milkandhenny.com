import { useCallback } from "react";
import { useLiveRoomSnapshot } from "../shared/useLiveRoomSnapshot";
import { useMultiplayerWakeSocket } from "../shared/useMultiplayerWakeSocket";
import { MULTIPLAYER_REALTIME_LIMITS } from "../shared/multiplayer-realtime";
import { readTwinSnapshotFn } from "./twin-room.functions";
import type { TwinSnapshot } from "./types";

export function useTwinRoom(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
  initialSnapshot?: TwinSnapshot;
}) {
  const read = useCallback(
    (lastSequence: number, lastDigest: string | null) =>
      readTwinSnapshotFn({
        data: {
          roomId: input.roomId,
          playerId: input.playerId,
          playerToken: input.playerToken,
          lastSequence,
          lastDigest,
        },
      }).then((result) => {
        if (!result.ok) return { ok: false, error: result.error } as const;
        if (result.unchanged)
          return { ok: true, unchanged: true, serverNow: result.serverNow } as const;
        return { ok: true, snapshot: result.snapshot } as const;
      }),
    [input.playerId, input.playerToken, input.roomId],
  );

  const room = useLiveRoomSnapshot<TwinSnapshot>({
    // Heats are seconds long, so the safety poll sits closer than the other games'. The wake socket
    // still carries almost every update; this only has to catch a dropped one before a heat ends.
    intervalMs: MULTIPLAYER_REALTIME_LIMITS.safetyReconciliationIntervalMs,
    roomKey: `${input.roomId}:${input.playerId}:${input.playerToken}`,
    initialSnapshot: input.initialSnapshot,
    read,
    boundariesOf: (snapshot) =>
      snapshot.heat
        ? [
            snapshot.heat.revealAt,
            snapshot.heat.deadlineAt,
            snapshot.heat.graceEndsAt,
            snapshot.heat.settleAt,
            snapshot.heat.nextHeatAt,
          ]
        : [],
  });

  const socket = useMultiplayerWakeSocket({
    path: "/api/things/twin-ws",
    hello: room.ended
      ? null
      : {
          roomId: input.roomId,
          playerId: input.playerId,
          playerToken: input.playerToken,
        },
    onWake: () => void room.refresh(),
    onTerminal: () => void room.refresh(),
  });

  return {
    snapshot: room.snapshot,
    setSnapshot: room.setSnapshot,
    clockOffset: room.clockOffset,
    connectionState: socket.state,
    notify: socket.notify,
    refresh: room.refresh,
    ended: room.ended,
    message: room.message,
    setMessage: room.setMessage,
  };
}
