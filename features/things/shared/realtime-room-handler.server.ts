import { defineWebSocketHandler } from "nitro/h3";
import {
  isMultiplayerClientControlMessage,
  MULTIPLAYER_REALTIME_LIMITS,
  MULTIPLAYER_SOCKET_CLOSE,
} from "./multiplayer-realtime";
import { multiplayerRecord } from "./multiplayer-validation";

interface RealtimeRoomSession {
  roomId: string;
}

interface RealtimeRoomHandlerOptions<Session extends RealtimeRoomSession> {
  authorize: (hello: Record<string, unknown>) => Promise<Session | null>;
  channel: (roomId: string) => string;
  wakeMessage?: (session: Session) => Record<string, string>;
}

interface RealtimeConnection<Session> {
  lastWakeAt: number;
  messageCount: number;
  rateWindowStartedAt: number;
  session: Session;
}

/** Shared authenticated wake-up transport. Game state remains authoritative over HTTPS. */
export function createRealtimeRoomHandler<Session extends RealtimeRoomSession>(
  options: RealtimeRoomHandlerOptions<Session>,
) {
  const connections = new Map<string, RealtimeConnection<Session>>();
  const channelFor = (session: Session) => options.channel(session.roomId);
  const wakeFor = (session: Session) =>
    JSON.stringify(options.wakeMessage?.(session) ?? { type: "wake" });
  const forget = (peer: { id: string; unsubscribe: (channel: string) => void }) => {
    const connection = connections.get(peer.id);
    if (connection) peer.unsubscribe(channelFor(connection.session));
    connections.delete(peer.id);
  };

  return defineWebSocketHandler({
    async message(peer, message) {
      let payload: Record<string, unknown>;
      try {
        if (message.text().length > MULTIPLAYER_REALTIME_LIMITS.maxMessageCharacters) {
          peer.close(MULTIPLAYER_SOCKET_CLOSE.messageTooLarge, "message too large");
          return;
        }
        payload = multiplayerRecord(message.json());
      } catch {
        peer.close(MULTIPLAYER_SOCKET_CLOSE.policyViolation, "invalid message");
        return;
      }

      if (payload.type === "hello") {
        if (connections.has(peer.id)) {
          forget(peer);
          peer.close(MULTIPLAYER_SOCKET_CLOSE.policyViolation, "hello already received");
          return;
        }
        const session = await options.authorize(payload).catch(() => null);
        if (!session) {
          peer.close(MULTIPLAYER_SOCKET_CLOSE.policyViolation, "unauthorized");
          return;
        }
        connections.set(peer.id, {
          lastWakeAt: 0,
          messageCount: 1,
          rateWindowStartedAt: Date.now(),
          session,
        });
        peer.subscribe(channelFor(session));
        peer.send(JSON.stringify({ type: "ready" }));
        peer.publish(channelFor(session), wakeFor(session));
        return;
      }

      const connection = connections.get(peer.id);
      if (!connection) {
        peer.close(MULTIPLAYER_SOCKET_CLOSE.policyViolation, "hello required");
        return;
      }
      const now = Date.now();
      if (now - connection.rateWindowStartedAt >= MULTIPLAYER_REALTIME_LIMITS.rateWindowMs) {
        connection.messageCount = 0;
        connection.rateWindowStartedAt = now;
      }
      connection.messageCount += 1;
      if (connection.messageCount > MULTIPLAYER_REALTIME_LIMITS.maxMessagesPerWindow) {
        forget(peer);
        peer.close(MULTIPLAYER_SOCKET_CLOSE.policyViolation, "message rate exceeded");
        return;
      }
      if (!isMultiplayerClientControlMessage(payload)) {
        forget(peer);
        peer.close(MULTIPLAYER_SOCKET_CLOSE.policyViolation, "unsupported message");
        return;
      }
      if (payload.type === "ping") {
        peer.send(JSON.stringify({ type: "pong" }));
      } else {
        if (now - connection.lastWakeAt < MULTIPLAYER_REALTIME_LIMITS.minimumWakeIntervalMs)
          return;
        connection.lastWakeAt = now;
        peer.publish(channelFor(connection.session), wakeFor(connection.session));
      }
    },
    close(peer) {
      forget(peer);
    },
    error(peer) {
      forget(peer);
    },
  });
}
