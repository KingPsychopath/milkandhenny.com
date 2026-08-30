import { useCallback } from "react";

import { MULTIPLAYER_REALTIME_LIMITS } from "../shared/multiplayer-realtime";
import { useLiveRoomSnapshot } from "../shared/useLiveRoomSnapshot";
import { useMultiplayerWakeSocket } from "../shared/useMultiplayerWakeSocket";
import { readFamilyFeudSnapshotFn } from "./family-feud-room.functions";
import type { FamilyFeudSnapshot, FamilyFeudViewerRole } from "./types";

export function useFamilyFeudRoom(input: {
  roomId: string;
  role: FamilyFeudViewerRole;
  credential: string;
}) {
  const read = useCallback(
    (lastSequence: number, lastDigest: string | null) =>
      readFamilyFeudSnapshotFn({
        data: {
          roomId: input.roomId,
          role: input.role,
          credential: input.credential,
          lastSequence,
          lastDigest,
        },
      }).then((result) => {
        if (!result.ok) return { ok: false as const, error: result.error };
        if (result.unchanged)
          return { ok: true as const, unchanged: true as const, serverNow: result.serverNow };
        return { ok: true as const, snapshot: result.snapshot };
      }),
    [input.credential, input.role, input.roomId],
  );
  const room = useLiveRoomSnapshot<FamilyFeudSnapshot>({
    enabled: Boolean(input.credential),
    intervalMs: MULTIPLAYER_REALTIME_LIMITS.safetyReconciliationIntervalMs,
    roomKey: input.credential ? `${input.roomId}:${input.role}:${input.credential}` : null,
    read,
    boundariesOf: (snapshot) => [snapshot.round?.phaseEndsAt],
  });
  const socket = useMultiplayerWakeSocket({
    path: "/api/things/family-feud-ws",
    hello:
      input.credential && !room.ended
        ? { roomId: input.roomId, role: input.role, credential: input.credential }
        : null,
    onWake: () => void room.refresh(),
    onTerminal: () => void room.refresh(),
  });
  return {
    ...room,
    connectionState: socket.state,
    notify: socket.notify,
  };
}
