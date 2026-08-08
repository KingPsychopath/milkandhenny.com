import { useCallback } from "react";
import { useLiveRoomSnapshot } from "../shared/useLiveRoomSnapshot";
import { useMultiplayerWakeSocket } from "../shared/useMultiplayerWakeSocket";
import { readLiarsSnapshotFn } from "./liars-room.functions";
import type { LiarsSnapshot } from "./types";

export function useLiarsRoom(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
  initialSnapshot?: LiarsSnapshot;
}) {
  const read = useCallback(
    (lastSequence: number, lastDigest: string | null) =>
      readLiarsSnapshotFn({
        data: {
          roomId: input.roomId,
          credential: input.playerToken,
          playerId: input.playerId,
          lastSequence,
          lastDigest,
        },
      }).then((result) => {
        if (!result.ok) return { ok: false, error: result.error } as const;
        // Nothing to apply — the viewer already holds this exact view.
        if (result.unchanged)
          return { ok: true, unchanged: true, serverNow: result.serverNow } as const;
        return { ok: true, snapshot: result.snapshot } as const;
      }),
    [input.playerId, input.playerToken, input.roomId],
  );

  const room = useLiveRoomSnapshot<LiarsSnapshot>({
    intervalMs: 6_000,
    roomKey: `${input.roomId}:${input.playerId}:${input.playerToken}`,
    initialSnapshot: input.initialSnapshot,
    read,
    // Every moment the room changes on its own, so a read lands just after each rather than
    // waiting out the poll and arriving late to the beat.
    boundariesOf: (snapshot) => [
      snapshot.phaseEndsAt,
      snapshot.nightOpensAt,
      snapshot.reportAt,
      snapshot.dawn?.nameLandsAt,
      snapshot.dawn?.reviveAt,
      snapshot.dawn?.settleAt,
    ],
  });

  const socket = useMultiplayerWakeSocket({
    path: "/api/things/liars-ws",
    hello: room.ended
      ? null
      : { roomId: input.roomId, credential: input.playerToken, playerId: input.playerId },
    onWake: () => void room.refresh(),
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
