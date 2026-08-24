import { useCallback } from "react";
import { useLiveRoomSnapshot } from "../shared/useLiveRoomSnapshot";
import { useMultiplayerWakeSocket } from "../shared/useMultiplayerWakeSocket";
import { MULTIPLAYER_REALTIME_LIMITS } from "../shared/multiplayer-realtime";
import { readHotAndColdSnapshotFn } from "./hot-and-cold.functions";
import type { HotAndColdSnapshot } from "./types";

export function useHotAndColdRoom(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
  initialSnapshot?: HotAndColdSnapshot;
}) {
  const read = useCallback(
    (_lastSequence: number, lastDigest: string | null) =>
      readHotAndColdSnapshotFn({
        data: {
          roomId: input.roomId,
          playerId: input.playerId,
          playerToken: input.playerToken,
          lastDigest,
        },
      }).then((result) =>
        !result.ok
          ? ({ ok: false, error: result.error } as const)
          : result.unchanged
            ? ({ ok: true, unchanged: true, serverNow: result.serverNow } as const)
            : ({ ok: true, snapshot: result.snapshot } as const),
      ),
    [input.playerId, input.playerToken, input.roomId],
  );
  const room = useLiveRoomSnapshot<HotAndColdSnapshot>({
    intervalMs: MULTIPLAYER_REALTIME_LIMITS.safetyReconciliationIntervalMs,
    roomKey: `${input.roomId}:${input.playerId}`,
    initialSnapshot: input.initialSnapshot,
    read,
    boundariesOf: (snapshot) => (snapshot.round?.turnEndsAt ? [snapshot.round.turnEndsAt] : []),
  });
  const socket = useMultiplayerWakeSocket({
    path: "/api/things/hot-and-cold-ws",
    hello: room.ended
      ? null
      : { roomId: input.roomId, playerId: input.playerId, playerToken: input.playerToken },
    onWake: () => void room.refresh(),
    onTerminal: () => void room.refresh(),
  });
  return { ...room, connectionState: socket.state, notify: socket.notify };
}
