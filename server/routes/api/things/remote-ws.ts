import { authorizePairedGameSocket } from "@/features/things/remote/paired-game-room.server";
import { pairedGameRealtimeChannel } from "@/features/things/remote/remote-keys";
import type { PairedGameRoomRole } from "@/features/things/remote/types";
import { createMultiplayerWakeHandler } from "@/features/things/shared/multiplayer-wake-handler.server";

interface PairedGameWakeSession {
  roomId: string;
  role: PairedGameRoomRole;
}

export default createMultiplayerWakeHandler<PairedGameWakeSession>({
  channel: pairedGameRealtimeChannel,
  game: "remote",
  async authorize(payload) {
    const roomId = typeof payload.roomId === "string" ? payload.roomId : "";
    const token = typeof payload.token === "string" ? payload.token : "";
    const role = payload.role;
    if ((role !== "player" && role !== "judge") || !roomId || !token) return null;
    return (await authorizePairedGameSocket({ roomId, role, token })) ? { roomId, role } : null;
  },
  wakeMessage: ({ role }) => ({ type: "wake", source: role }),
});
