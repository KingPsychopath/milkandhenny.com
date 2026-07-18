import { authorizeRemoteSocket } from "@/features/things/remote/remote-room.server";
import { remoteRealtimeChannel } from "@/features/things/remote/remote-keys";
import type { RemoteRoomRole } from "@/features/things/remote/types";
import { createRealtimeRoomHandler } from "@/features/things/shared/realtime-room-handler.server";

interface RemoteRealtimeSession {
  roomId: string;
  role: RemoteRoomRole;
}

export default createRealtimeRoomHandler<RemoteRealtimeSession>({
  channel: remoteRealtimeChannel,
  game: "remote",
  async authorize(payload) {
    const roomId = typeof payload.roomId === "string" ? payload.roomId : "";
    const token = typeof payload.token === "string" ? payload.token : "";
    const role = payload.role;
    if ((role !== "player" && role !== "judge") || !roomId || !token) return null;
    return (await authorizeRemoteSocket({ roomId, role, token })) ? { roomId, role } : null;
  },
  wakeMessage: ({ role }) => ({ type: "wake", source: role }),
});
