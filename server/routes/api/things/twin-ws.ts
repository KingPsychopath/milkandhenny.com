import { authorizeTwinSocket } from "@/features/things/twin/twin-room.server";
import { twinRealtimeChannel } from "@/features/things/twin/twin-keys";
import { createMultiplayerWakeHandler } from "@/features/things/shared/multiplayer-wake-handler.server";

interface TwinSession {
  roomId: string;
  playerId: string;
}

export default createMultiplayerWakeHandler<TwinSession>({
  channel: twinRealtimeChannel,
  game: "twin",
  async authorize(payload) {
    const roomId = typeof payload.roomId === "string" ? payload.roomId : "";
    const playerId = typeof payload.playerId === "string" ? payload.playerId : "";
    const playerToken = typeof payload.playerToken === "string" ? payload.playerToken : "";
    return (await authorizeTwinSocket({ roomId, playerId, playerToken }))
      ? { roomId, playerId }
      : null;
  },
});
