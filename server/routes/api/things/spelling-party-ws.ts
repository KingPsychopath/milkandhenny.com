import { defineWebSocketHandler } from "nitro/h3";
import { authorizePartySocket } from "@/features/things/spelling-party/party-room.server";
import type { PartyRole } from "@/features/things/spelling-party/types";
import { gameRealtimeChannels } from "@/features/things/shared/game-keys";

const sessions = new Map<string, { roomId: string; role: PartyRole; playerId?: string }>();

export default defineWebSocketHandler({
  async message(peer, message) {
    let payload: { type?: string; roomId?: string; role?: string; credential?: string; playerId?: string };
    try {
      if (message.text().length > 1_000) { peer.close(1009, "message too large"); return; }
      payload = message.json();
    } catch { peer.close(1008, "invalid message"); return; }
    if (payload.type === "hello") {
      if ((payload.role !== "presenter" && payload.role !== "player") || !payload.roomId || !payload.credential) { peer.close(1008, "invalid hello"); return; }
      const authorized = await authorizePartySocket({ roomId: payload.roomId, role: payload.role, credential: payload.credential, playerId: payload.playerId });
      if (!authorized) { peer.close(1008, "unauthorized"); return; }
      sessions.set(peer.id, { roomId: payload.roomId, role: payload.role, playerId: payload.playerId });
      peer.subscribe(gameRealtimeChannels.spellingPartyRoom(payload.roomId));
      peer.send(JSON.stringify({ type: "ready" }));
      peer.publish(gameRealtimeChannels.spellingPartyRoom(payload.roomId), JSON.stringify({ type: "wake" }));
      return;
    }
    const session = sessions.get(peer.id);
    if (!session) { peer.close(1008, "hello required"); return; }
    if (payload.type === "ping") peer.send(JSON.stringify({ type: "pong" }));
    if (payload.type === "changed") peer.publish(gameRealtimeChannels.spellingPartyRoom(session.roomId), JSON.stringify({ type: "wake" }));
  },
  close(peer) { const session = sessions.get(peer.id); if (session) peer.unsubscribe(gameRealtimeChannels.spellingPartyRoom(session.roomId)); sessions.delete(peer.id); },
  error(peer) { sessions.delete(peer.id); },
});
