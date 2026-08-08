import { authorizeCentreSocket } from "@/features/things/centre/centre-room.server";
import { centreRealtimeChannel } from "@/features/things/centre/centre-keys";
import { createMultiplayerWakeHandler } from "@/features/things/shared/multiplayer-wake-handler.server";

interface CentreSession {
  roomId: string;
  playerId: string;
}

export default createMultiplayerWakeHandler<CentreSession>({
  channel: centreRealtimeChannel,
  game: "centre",
  async authorize(payload) {
    const roomId = typeof payload.roomId === "string" ? payload.roomId : "";
    const playerId = typeof payload.playerId === "string" ? payload.playerId : "";
    const playerToken = typeof payload.playerToken === "string" ? payload.playerToken : "";
    return (await authorizeCentreSocket({ roomId, playerId, playerToken }))
      ? { roomId, playerId }
      : null;
  },
  relayMessage(payload, session) {
    if (
      payload.type !== "presence" ||
      typeof payload.x !== "number" ||
      !Number.isFinite(payload.x) ||
      Math.abs(payload.x) > 1.1 ||
      typeof payload.y !== "number" ||
      !Number.isFinite(payload.y) ||
      Math.abs(payload.y) > 1.1 ||
      typeof payload.t !== "number" ||
      !Number.isInteger(payload.t) ||
      payload.t < 0 ||
      payload.t > 300_000 ||
      typeof payload.sequence !== "number" ||
      !Number.isInteger(payload.sequence) ||
      payload.sequence < 0
    )
      return null;
    return {
      type: "presence",
      playerId: session.playerId,
      x: Math.round(payload.x * 10_000) / 10_000,
      y: Math.round(payload.y * 10_000) / 10_000,
      t: payload.t,
      sequence: payload.sequence,
    };
  },
});
