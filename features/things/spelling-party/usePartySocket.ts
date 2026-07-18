import { useMultiplayerWakeSocket, type MultiplayerWakeSocketState } from "../shared/useMultiplayerWakeSocket";
import type { PartyRole } from "./types";

export type PartyConnectionState = MultiplayerWakeSocketState;

export function usePartySocket(input: { roomId: string | null; role: PartyRole; credential: string | null; playerId?: string; onWake: () => void }) {
  return useMultiplayerWakeSocket({
    path: "/api/things/spelling-party-ws",
    hello: input.roomId && input.credential ? { roomId: input.roomId, role: input.role, credential: input.credential, playerId: input.playerId } : null,
    onWake: input.onWake,
  });
}
