import { useReliableGameSocket, type ReliableGameSocketState } from "../shared/useReliableGameSocket";
import type { PartyRole } from "./types";

export type PartyConnectionState = ReliableGameSocketState;

export function usePartySocket(input: { roomId: string | null; role: PartyRole; credential: string | null; playerId?: string; onWake: () => void }) {
  return useReliableGameSocket({
    path: "/api/things/spelling-party-ws",
    hello: input.roomId && input.credential ? { roomId: input.roomId, role: input.role, credential: input.credential, playerId: input.playerId } : null,
    onWake: input.onWake,
  });
}
