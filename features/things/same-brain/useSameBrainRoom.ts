import { useCallback } from "react";
import { useLiveRoomSnapshot } from "../shared/useLiveRoomSnapshot";
import { useMultiplayerWakeSocket } from "../shared/useMultiplayerWakeSocket";
import { readSameBrainSnapshotFn } from "./same-brain-room.functions";
import type { SameBrainSnapshot } from "./types";

export function useSameBrainRoom(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
  initialSnapshot?: SameBrainSnapshot;
}) {
  const read = useCallback(
    () =>
      readSameBrainSnapshotFn({
        data: {
          roomId: input.roomId,
          credential: input.playerToken,
          playerId: input.playerId,
          lastSequence: 0,
        },
      }).then((result) =>
        result.ok
          ? ({ ok: true, snapshot: result.snapshot } as const)
          : ({ ok: false, error: result.error } as const),
      ),
    [input.playerId, input.playerToken, input.roomId],
  );

  const room = useLiveRoomSnapshot<SameBrainSnapshot>({
    intervalMs: 5_000,
    roomKey: `${input.roomId}:${input.playerId}:${input.playerToken}`,
    initialSnapshot: input.initialSnapshot,
    read,
    // Both moments the room moves on its own. A read landing just after `phaseEndsAt` is what closes
    // submit and triggers scoring, so this is not only cosmetic — it is the game's clock.
    boundariesOf: (snapshot) => [snapshot.phaseEndsAt],
  });

  const socket = useMultiplayerWakeSocket({
    path: "/api/things/same-brain-ws",
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
