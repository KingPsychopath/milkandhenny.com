import { authorizeLiarsSocket } from "@/features/things/liars/liars-room.server";
import { liarsRealtimeChannel } from "@/features/things/liars/liars-keys";
import { createMultiplayerWakeHandler } from "@/features/things/shared/multiplayer-wake-handler.server";

interface LiarsRealtimeSession {
  roomId: string;
  playerId?: string;
}

export default createMultiplayerWakeHandler<LiarsRealtimeSession>({
  channel: liarsRealtimeChannel,
  game: "liars",
  async authorize(payload) {
    const roomId = typeof payload.roomId === "string" ? payload.roomId : "";
    const credential = typeof payload.credential === "string" ? payload.credential : "";
    const playerId = typeof payload.playerId === "string" ? payload.playerId : undefined;
    if (!roomId || !credential) return null;
    return (await authorizeLiarsSocket({ roomId, credential, playerId }))
      ? { roomId, playerId }
      : null;
  },
});
