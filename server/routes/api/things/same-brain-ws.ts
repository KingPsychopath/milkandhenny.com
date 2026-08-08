import { authorizeSameBrainSocket } from "@/features/things/same-brain/same-brain-room.server";
import { sameBrainRealtimeChannel } from "@/features/things/same-brain/same-brain-keys";
import { createMultiplayerWakeHandler } from "@/features/things/shared/multiplayer-wake-handler.server";

interface SameBrainRealtimeSession {
  roomId: string;
  playerId?: string;
}

export default createMultiplayerWakeHandler<SameBrainRealtimeSession>({
  channel: sameBrainRealtimeChannel,
  game: "same-brain",
  async authorize(payload) {
    const roomId = typeof payload.roomId === "string" ? payload.roomId : "";
    const credential = typeof payload.credential === "string" ? payload.credential : "";
    const playerId = typeof payload.playerId === "string" ? payload.playerId : undefined;
    if (!roomId || !credential) return null;
    return (await authorizeSameBrainSocket({ roomId, credential, playerId }))
      ? { roomId, playerId }
      : null;
  },
});
