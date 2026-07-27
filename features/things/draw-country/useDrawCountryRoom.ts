import { useCallback } from "react";
import { useLiveRoomSnapshot } from "../shared/useLiveRoomSnapshot";
import { useMultiplayerWakeSocket } from "../shared/useMultiplayerWakeSocket";
import { readDrawCountrySnapshotFn } from "./draw-country-room.functions";
import type { DrawCountrySnapshot } from "./types";

export function useDrawCountryRoom(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
  initialSnapshot?: DrawCountrySnapshot;
}) {
  const read = useCallback(
    () =>
      readDrawCountrySnapshotFn({
        data: {
          roomId: input.roomId,
          playerId: input.playerId,
          playerToken: input.playerToken,
        },
      }).then((result) =>
        result.ok
          ? ({ ok: true, snapshot: result.snapshot } as const)
          : ({ ok: false, error: result.error } as const),
      ),
    [input.playerId, input.playerToken, input.roomId],
  );

  const room = useLiveRoomSnapshot<DrawCountrySnapshot>({
    intervalMs: 8_000,
    roomKey: `${input.roomId}:${input.playerId}:${input.playerToken}`,
    initialSnapshot: input.initialSnapshot,
    read,
    boundariesOf: (snapshot) =>
      snapshot.round
        ? [snapshot.round.startsAt, snapshot.round.endsAt, snapshot.round.nextRoundAt]
        : [],
  });

  const socket = useMultiplayerWakeSocket({
    path: "/api/things/draw-country-ws",
    hello: room.ended
      ? null
      : {
          roomId: input.roomId,
          playerId: input.playerId,
          playerToken: input.playerToken,
        },
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
