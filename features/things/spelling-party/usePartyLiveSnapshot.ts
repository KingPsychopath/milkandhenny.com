import { useCallback } from "react";
import { useLiveRoomSnapshot } from "../shared/useLiveRoomSnapshot";
import { readPartySnapshotFn } from "./party-room.functions";
import type { PartyRole, PartySnapshot } from "./types";
import { usePartySocket } from "./usePartySocket";

export function usePartyLiveSnapshot(input: {
  roomId: string;
  role: PartyRole;
  credential: string;
  playerId?: string;
  presenterToken?: string;
  initialSnapshot?: PartySnapshot;
}) {
  const read = useCallback(
    (lastSequence: number) =>
      readPartySnapshotFn({
        data: {
          roomId: input.roomId,
          role: input.role,
          credential: input.credential,
          playerId: input.playerId,
          presenterToken: input.presenterToken,
          lastSequence,
        },
      }).then((result) =>
        result.ok
          ? ({ ok: true, snapshot: result.snapshot } as const)
          : ({ ok: false, error: result.error } as const),
      ),
    [input.credential, input.playerId, input.presenterToken, input.role, input.roomId],
  );

  const room = useLiveRoomSnapshot<PartySnapshot>({
    enabled: Boolean(input.credential),
    intervalMs: 10_000,
    roomKey: input.credential
      ? `${input.roomId}:${input.role}:${input.credential}:${input.playerId ?? ""}`
      : null,
    initialSnapshot: input.initialSnapshot,
    read,
    boundariesOf: (snapshot) =>
      snapshot.round
        ? [
            snapshot.round.answerOpensAt,
            snapshot.round.answerLocksAt,
            snapshot.round.revealAt,
            snapshot.round.nextRoundAt,
          ]
        : [],
  });

  const socket = usePartySocket({
    roomId: room.ended ? null : input.roomId,
    role: input.role,
    credential: room.ended ? null : input.credential,
    playerId: input.playerId,
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
