import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveRoomSnapshot } from "../shared/useLiveRoomSnapshot";
import { useMultiplayerWakeSocket } from "../shared/useMultiplayerWakeSocket";
import { readCentreSnapshotFn } from "./centre-room.functions";
import type { CentreSnapshot } from "./types";

export function useCentreRoom(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
  initialSnapshot?: CentreSnapshot;
}) {
  const [presence, setPresence] = useState<
    Record<string, { x: number; y: number; sequence: number }>
  >({});
  const presenceTimers = useRef(new Set<number>());
  useEffect(
    () => () => {
      for (const timer of presenceTimers.current) window.clearTimeout(timer);
      presenceTimers.current.clear();
    },
    [],
  );
  const read = useCallback(
    (lastSequence: number, lastDigest: string | null) =>
      readCentreSnapshotFn({
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
  const room = useLiveRoomSnapshot<CentreSnapshot>({
    intervalMs: 5_000,
    roomKey: `${input.roomId}:${input.playerId}:${input.playerToken}`,
    initialSnapshot: input.initialSnapshot,
    read,
    boundariesOf: (snapshot) => [
      snapshot.course?.startsAt,
      snapshot.course?.firstFinishAt,
      snapshot.course?.endsAt,
    ],
  });
  const socket = useMultiplayerWakeSocket({
    path: "/api/things/centre-ws",
    hello: room.ended
      ? null
      : {
          roomId: input.roomId,
          playerId: input.playerId,
          playerToken: input.playerToken,
        },
    onWake: () => void room.refresh(),
    onMessage: (message) => {
      if (!message || typeof message !== "object" || Array.isArray(message)) return;
      const value = message as Record<string, unknown>;
      if (
        value.type !== "presence" ||
        typeof value.playerId !== "string" ||
        value.playerId === input.playerId ||
        typeof value.x !== "number" ||
        typeof value.y !== "number" ||
        typeof value.sequence !== "number"
      )
        return;
      const timer = window.setTimeout(() => {
        presenceTimers.current.delete(timer);
        setPresence((current) => {
          const previous = current[value.playerId as string];
          if (previous && previous.sequence >= (value.sequence as number)) return current;
          return {
            ...current,
            [value.playerId as string]: {
              x: value.x as number,
              y: value.y as number,
              sequence: value.sequence as number,
            },
          };
        });
      }, 1_500);
      presenceTimers.current.add(timer);
    },
  });
  return {
    ...room,
    connectionState: socket.state,
    notify: socket.notify,
    presence,
    sendPresence: socket.sendEphemeral,
  };
}
