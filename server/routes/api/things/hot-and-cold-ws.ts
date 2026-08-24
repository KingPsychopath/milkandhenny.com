import { authorizeHotAndColdSocket } from "@/features/things/hot-and-cold/hot-and-cold-room.server";
import { hotAndColdRealtimeChannel } from "@/features/things/hot-and-cold/hot-and-cold-keys";
import { createMultiplayerWakeHandler } from "@/features/things/shared/multiplayer-wake-handler.server";

export default createMultiplayerWakeHandler<{ roomId: string; playerId: string }>({
  channel: hotAndColdRealtimeChannel,
  game: "hot-and-cold",
  async authorize(payload) {
    const roomId = typeof payload.roomId === "string" ? payload.roomId : "";
    const playerId = typeof payload.playerId === "string" ? payload.playerId : "";
    const playerToken = typeof payload.playerToken === "string" ? payload.playerToken : "";
    return roomId &&
      playerId &&
      playerToken &&
      (await authorizeHotAndColdSocket({ roomId, playerId, playerToken }))
      ? { roomId, playerId }
      : null;
  },
});
