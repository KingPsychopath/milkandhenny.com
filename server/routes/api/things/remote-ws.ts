import { defineWebSocketHandler } from "nitro/h3";
import { authorizeRemoteSocket } from "@/features/things/remote/remote-room.server";
import type { RemoteRoomRole } from "@/features/things/remote/types";

const sessions = new Map<string, { roomId: string; role: RemoteRoomRole }>();

export default defineWebSocketHandler({
  async message(peer, message) {
    let payload: { type?: string; roomId?: string; role?: string; token?: string };
    try {
      if (message.text().length > 1_000) {
        peer.close(1009, "message too large");
        return;
      }
      payload = message.json();
    } catch {
      peer.close(1008, "invalid message");
      return;
    }
    if (payload.type === "hello") {
      if ((payload.role !== "player" && payload.role !== "judge") || !payload.roomId || !payload.token) {
        peer.close(1008, "invalid hello");
        return;
      }
      const authorized = await authorizeRemoteSocket({
        roomId: payload.roomId,
        role: payload.role,
        token: payload.token,
      });
      if (!authorized) {
        peer.close(1008, "unauthorized");
        return;
      }
      sessions.set(peer.id, { roomId: payload.roomId, role: payload.role });
      peer.subscribe(`remote-room:${payload.roomId}`);
      peer.send(JSON.stringify({ type: "ready" }));
      peer.publish(`remote-room:${payload.roomId}`, JSON.stringify({ type: "wake", source: payload.role }));
      return;
    }
    const session = sessions.get(peer.id);
    if (!session) {
      peer.close(1008, "hello required");
      return;
    }
    if (payload.type === "ping") {
      peer.send(JSON.stringify({ type: "pong" }));
    } else if (payload.type === "changed") {
      peer.publish(`remote-room:${session.roomId}`, JSON.stringify({ type: "wake", source: session.role }));
    }
  },
  close(peer) {
    const session = sessions.get(peer.id);
    if (session) peer.unsubscribe(`remote-room:${session.roomId}`);
    sessions.delete(peer.id);
  },
  error(peer) {
    sessions.delete(peer.id);
  },
});
