import { defineWebSocketHandler } from "nitro/h3";
import type { Effect } from "effect";
import { log } from "@/lib/platform/logger.server";
import {
  isMultiplayerClientControlMessage,
  MULTIPLAYER_REALTIME_LIMITS,
  MULTIPLAYER_SOCKET_CLOSE,
} from "./multiplayer-realtime";
import { runMultiplayerEffect } from "./multiplayer-runtime.server";
import { MultiplayerRealtimeBackplane } from "./multiplayer-realtime-backplane.server";
import { MultiplayerTelemetry } from "./multiplayer-telemetry.server";
import type { MultiplayerGame } from "./multiplayer-telemetry";
import { multiplayerRecord } from "./multiplayer-validation";

interface MultiplayerWakeSession {
  roomId: string;
}

interface MultiplayerWakeHandlerOptions<Session extends MultiplayerWakeSession> {
  authorize: (hello: Record<string, unknown>) => Promise<Session | null>;
  channel: (roomId: string) => string;
  game: MultiplayerGame;
  wakeMessage?: (session: Session) => Record<string, string>;
}

interface MultiplayerWakeConnection<Session> {
  lastWakeAt: number;
  messageCount: number;
  peer: { send: (message: string) => void };
  rateWindowStartedAt: number;
  session: Session;
}

/** Shared authenticated wake-up transport. Game state remains authoritative over HTTPS. */
export function createMultiplayerWakeHandler<Session extends MultiplayerWakeSession>(
  options: MultiplayerWakeHandlerOptions<Session>,
) {
  const connections = new Map<string, MultiplayerWakeConnection<Session>>();
  const roomConnectionCounts = new Map<string, number>();
  const terminatedPeers = new Set<string>();
  const channelFor = (session: Session) => options.channel(session.roomId);
  const wakeFor = (session: Session) =>
    JSON.stringify(options.wakeMessage?.(session) ?? { type: "wake" });
  const forget = (peer: { id: string; unsubscribe: (channel: string) => void }) => {
    const connection = connections.get(peer.id);
    if (connection) {
      peer.unsubscribe(channelFor(connection.session));
      const count = roomConnectionCounts.get(connection.session.roomId) ?? 1;
      if (count <= 1) roomConnectionCounts.delete(connection.session.roomId);
      else roomConnectionCounts.set(connection.session.roomId, count - 1);
    }
    connections.delete(peer.id);
    return Boolean(connection);
  };
  const record = (use: (telemetry: typeof MultiplayerTelemetry.Service) => Effect.Effect<void>) =>
    runMultiplayerEffect(MultiplayerTelemetry.use(use));
  const ignoreTelemetryFailure = (promise: Promise<unknown>) => {
    void promise.catch((error) =>
      log.warn("things.multiplayer", "Realtime telemetry unavailable", {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  };
  let backplaneSubscription: Promise<void> | null = null;
  const ensureBackplane = () => {
    backplaneSubscription ??= runMultiplayerEffect(
      MultiplayerRealtimeBackplane.use((backplane) =>
        backplane.subscribe((channel, message) => {
          for (const connection of connections.values()) {
            if (channelFor(connection.session) === channel) connection.peer.send(message);
          }
        }),
      ),
    )
      .then(() => undefined)
      .catch((error) => {
        backplaneSubscription = null;
        log.warn("things.multiplayer", "Realtime backplane unavailable", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return backplaneSubscription;
  };
  const publishWake = async (
    peer: { publish: (channel: string, message: string) => void },
    session: Session,
  ) => {
    const channel = channelFor(session);
    const message = wakeFor(session);
    peer.publish(channel, message);
    await ensureBackplane();
    await runMultiplayerEffect(
      MultiplayerRealtimeBackplane.use((backplane) => backplane.publish(channel, message)),
    ).catch((error) =>
      log.warn("things.multiplayer", "Realtime backplane publication unavailable", {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  };
  const terminate = (
    peer: {
      id: string;
      unsubscribe: (channel: string) => void;
      close: (code: number, reason: string) => void;
    },
    code: number,
    reason: string,
    message: string,
  ) => {
    const wasActive = forget(peer);
    terminatedPeers.add(peer.id);
    ignoreTelemetryFailure(
      record((telemetry) => telemetry.socketClosed(options.game, reason, wasActive)),
    );
    peer.close(code, message);
  };

  return defineWebSocketHandler({
    async message(peer, message) {
      let payload: Record<string, unknown>;
      try {
        if (message.text().length > MULTIPLAYER_REALTIME_LIMITS.maxMessageCharacters) {
          terminate(
            peer,
            MULTIPLAYER_SOCKET_CLOSE.messageTooLarge,
            "message_too_large",
            "message too large",
          );
          return;
        }
        payload = multiplayerRecord(message.json());
      } catch {
        terminate(
          peer,
          MULTIPLAYER_SOCKET_CLOSE.policyViolation,
          "invalid_message",
          "invalid message",
        );
        return;
      }

      if (payload.type === "hello") {
        if (connections.has(peer.id)) {
          terminate(
            peer,
            MULTIPLAYER_SOCKET_CLOSE.policyViolation,
            "hello_repeated",
            "hello already received",
          );
          return;
        }
        if (connections.size >= MULTIPLAYER_REALTIME_LIMITS.maxConnectionsPerProcess) {
          terminate(
            peer,
            MULTIPLAYER_SOCKET_CLOSE.serverOverloaded,
            "server_overloaded",
            "server busy",
          );
          return;
        }
        const session = await options.authorize(payload).catch(() => null);
        if (!session) {
          terminate(peer, MULTIPLAYER_SOCKET_CLOSE.policyViolation, "unauthorized", "unauthorized");
          return;
        }
        if (
          (roomConnectionCounts.get(session.roomId) ?? 0) >=
          MULTIPLAYER_REALTIME_LIMITS.maxConnectionsPerRoom
        ) {
          terminate(
            peer,
            MULTIPLAYER_SOCKET_CLOSE.serverOverloaded,
            "server_overloaded",
            "room busy",
          );
          return;
        }
        connections.set(peer.id, {
          lastWakeAt: 0,
          messageCount: 1,
          peer,
          rateWindowStartedAt: Date.now(),
          session,
        });
        roomConnectionCounts.set(
          session.roomId,
          (roomConnectionCounts.get(session.roomId) ?? 0) + 1,
        );
        await record((telemetry) => telemetry.socketOpened(options.game));
        peer.subscribe(channelFor(session));
        peer.send(JSON.stringify({ type: "ready" }));
        await publishWake(peer, session);
        return;
      }

      const connection = connections.get(peer.id);
      if (!connection) {
        terminate(
          peer,
          MULTIPLAYER_SOCKET_CLOSE.policyViolation,
          "hello_required",
          "hello required",
        );
        return;
      }
      const now = Date.now();
      if (now - connection.rateWindowStartedAt >= MULTIPLAYER_REALTIME_LIMITS.rateWindowMs) {
        connection.messageCount = 0;
        connection.rateWindowStartedAt = now;
      }
      connection.messageCount += 1;
      if (connection.messageCount > MULTIPLAYER_REALTIME_LIMITS.maxMessagesPerWindow) {
        await record((telemetry) => telemetry.recordRateLimit(options.game, "socket_message"));
        terminate(
          peer,
          MULTIPLAYER_SOCKET_CLOSE.policyViolation,
          "message_rate",
          "message rate exceeded",
        );
        return;
      }
      if (!isMultiplayerClientControlMessage(payload)) {
        terminate(
          peer,
          MULTIPLAYER_SOCKET_CLOSE.policyViolation,
          "unsupported_message",
          "unsupported message",
        );
        return;
      }
      if (payload.type === "ping") {
        peer.send(JSON.stringify({ type: "pong" }));
      } else {
        if (now - connection.lastWakeAt < MULTIPLAYER_REALTIME_LIMITS.minimumWakeIntervalMs) return;
        connection.lastWakeAt = now;
        await publishWake(peer, connection.session);
      }
    },
    close(peer) {
      if (terminatedPeers.delete(peer.id)) return;
      const wasActive = forget(peer);
      ignoreTelemetryFailure(
        record((telemetry) => telemetry.socketClosed(options.game, "client_closed", wasActive)),
      );
    },
    error(peer) {
      if (terminatedPeers.delete(peer.id)) return;
      const wasActive = forget(peer);
      ignoreTelemetryFailure(
        record((telemetry) => telemetry.socketClosed(options.game, "socket_error", wasActive)),
      );
    },
  });
}
