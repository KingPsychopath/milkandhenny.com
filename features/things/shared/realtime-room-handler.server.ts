import { defineWebSocketHandler } from "nitro/h3";
import { multiplayerRecord } from "./multiplayer-validation";

interface RealtimeRoomSession {
  roomId: string;
}

interface RealtimeRoomHandlerOptions<Session extends RealtimeRoomSession> {
  authorize: (hello: Record<string, unknown>) => Promise<Session | null>;
  channel: (roomId: string) => string;
  wakeMessage?: (session: Session) => Record<string, string>;
}

/** Shared authenticated wake-up transport. Game state remains authoritative over HTTPS. */
export function createRealtimeRoomHandler<Session extends RealtimeRoomSession>(
  options: RealtimeRoomHandlerOptions<Session>,
) {
  const sessions = new Map<string, Session>();
  const channelFor = (session: Session) => options.channel(session.roomId);
  const wakeFor = (session: Session) =>
    JSON.stringify(options.wakeMessage?.(session) ?? { type: "wake" });
  const forget = (peer: { id: string; unsubscribe: (channel: string) => void }) => {
    const session = sessions.get(peer.id);
    if (session) peer.unsubscribe(channelFor(session));
    sessions.delete(peer.id);
  };

  return defineWebSocketHandler({
    async message(peer, message) {
      let payload: Record<string, unknown>;
      try {
        if (message.text().length > 1_000) {
          peer.close(1009, "message too large");
          return;
        }
        payload = multiplayerRecord(message.json());
      } catch {
        peer.close(1008, "invalid message");
        return;
      }

      if (payload.type === "hello") {
        const session = await options.authorize(payload).catch(() => null);
        if (!session) {
          peer.close(1008, "unauthorized");
          return;
        }
        forget(peer);
        sessions.set(peer.id, session);
        peer.subscribe(channelFor(session));
        peer.send(JSON.stringify({ type: "ready" }));
        peer.publish(channelFor(session), wakeFor(session));
        return;
      }

      const session = sessions.get(peer.id);
      if (!session) {
        peer.close(1008, "hello required");
        return;
      }
      if (payload.type === "ping") peer.send(JSON.stringify({ type: "pong" }));
      else if (payload.type === "changed") peer.publish(channelFor(session), wakeFor(session));
    },
    close(peer) {
      forget(peer);
    },
    error(peer) {
      forget(peer);
    },
  });
}
