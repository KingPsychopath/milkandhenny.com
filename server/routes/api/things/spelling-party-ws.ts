import { authorizePartySocket } from "@/features/things/spelling-party/party-room.server";
import { partyRealtimeChannel } from "@/features/things/spelling-party/party-keys";
import type { PartyRole } from "@/features/things/spelling-party/types";
import { createRealtimeRoomHandler } from "@/features/things/shared/realtime-room-handler.server";

interface PartyRealtimeSession {
  roomId: string;
  role: PartyRole;
  playerId?: string;
}

export default createRealtimeRoomHandler<PartyRealtimeSession>({
  channel: partyRealtimeChannel,
  game: "spelling-party",
  async authorize(payload) {
    const roomId = typeof payload.roomId === "string" ? payload.roomId : "";
    const credential = typeof payload.credential === "string" ? payload.credential : "";
    const playerId = typeof payload.playerId === "string" ? payload.playerId : undefined;
    const role = payload.role;
    if ((role !== "presenter" && role !== "player") || !roomId || !credential) return null;
    return (await authorizePartySocket({ roomId, role, credential, playerId }))
      ? { roomId, role, playerId }
      : null;
  },
});
