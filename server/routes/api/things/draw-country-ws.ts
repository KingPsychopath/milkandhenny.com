import { authorizeDrawCountrySocket } from "@/features/things/draw-country/draw-country-room.server";
import { drawCountryRealtimeChannel } from "@/features/things/draw-country/draw-country-keys";
import { createMultiplayerWakeHandler } from "@/features/things/shared/multiplayer-wake-handler.server";

interface DrawCountrySession {
  roomId: string;
  playerId: string;
}

export default createMultiplayerWakeHandler<DrawCountrySession>({
  channel: drawCountryRealtimeChannel,
  game: "draw-country",
  async authorize(payload) {
    const roomId = typeof payload.roomId === "string" ? payload.roomId : "";
    const playerId = typeof payload.playerId === "string" ? payload.playerId : "";
    const playerToken = typeof payload.playerToken === "string" ? payload.playerToken : "";
    return (await authorizeDrawCountrySocket({ roomId, playerId, playerToken }))
      ? { roomId, playerId }
      : null;
  },
});
