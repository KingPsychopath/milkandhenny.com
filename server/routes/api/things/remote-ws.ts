import { authorizeRemoteSocket } from "@/features/things/remote/remote-room.server";
import type { RemoteRoomRole } from "@/features/things/remote/types";
import { gameRealtimeChannels } from "@/features/things/shared/game-keys";
import { createRealtimeRoomHandler } from "@/features/things/shared/realtime-room-handler.server";

interface RemoteRealtimeSession {
  roomId: string;
  role: RemoteRoomRole;
}

export default createRealtimeRoomHandler<RemoteRealtimeSession>({
  channel: gameRealtimeChannels.remoteRoom,
  async authorize(payload) {
    const roomId = typeof payload.roomId === "string" ? payload.roomId : "";
    const token = typeof payload.token === "string" ? payload.token : "";
    const role = payload.role;
    if ((role !== "player" && role !== "judge") || !roomId || !token) return null;
    return (await authorizeRemoteSocket({ roomId, role, token })) ? { roomId, role } : null;
  },
  wakeMessage: ({ role }) => ({ type: "wake", source: role }),
});
