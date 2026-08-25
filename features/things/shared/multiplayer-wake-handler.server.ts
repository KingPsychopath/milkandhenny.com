import { defineWebSocketHandler } from "nitro/h3";
import type { Effect } from "effect";
import { log } from "@/lib/platform/logger.server";
import { BASE_URL } from "@/lib/shared/config";
import {
  isMultiplayerClientControlMessage,
  isMultiplayerRealtimeMessage,
  MULTIPLAYER_REALTIME_LIMITS,
  MULTIPLAYER_SOCKET_CLOSE,
} from "./multiplayer-realtime";
import { runMultiplayerEffect } from "./multiplayer-runtime.server";
import { MultiplayerRealtimeBackplane } from "./multiplayer-realtime-backplane.server";
import { MultiplayerTelemetry } from "./multiplayer-telemetry.server";
import type { MultiplayerGame } from "./multiplayer-telemetry";
import { multiplayerRecord } from "./multiplayer-validation";

interface MultiplayerWakeSession {
  playerId?: string;
  roomId: string;
  role?: string;
}

interface MultiplayerWakeHandlerOptions<Session extends MultiplayerWakeSession> {
  authorize: (hello: Record<string, unknown>) => Promise<Session | null>;
  channel: (roomId: string) => string;
  game: MultiplayerGame;
  wakeMessage?: (session: Session) => Record<string, string>;
  /** Optional feature-owned cosmetic relay. Durable game commands never use this lane. */
  relayMessage?: (
    payload: Record<string, unknown>,
    session: Session,
  ) => Record<string, unknown> | null;
}

interface MultiplayerWakeConnection<Session> {
  lastActivityAt: number;
  lastWakeAt: number;
  messageCount: number;
  peer: {
    id: string;
    close: (code: number, reason: string) => void;
    send: (message: string) => void;
  };
  rateWindowStartedAt: number;
  session: Session;
}

function socketOriginAllowed(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return origin === new URL(request.url).origin || origin === new URL(BASE_URL).origin;
  } catch {
    return false;
  }
}

/** Shared authenticated wake-up transport. Game state remains authoritative over HTTPS. */
export function createMultiplayerWakeHandler<Session extends MultiplayerWakeSession>(
  options: MultiplayerWakeHandlerOptions<Session>,
) {
  const connections = new Map<string, MultiplayerWakeConnection<Session>>();
  const pendingPeers = new Set<string>();
  const helloInFlight = new Set<string>();
  const helloTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const roomConnectionCounts = new Map<string, number>();
  // Peer id → termination time. Entries normally clear on the close/error
  // event; the timestamp lets the idle sweep evict peers whose close
  // handshake never completes, so the map cannot grow without bound.
  const terminatedPeers = new Map<string, number>();
  const channelFor = (session: Session) => options.channel(session.roomId);
  const wakeFor = (session: Session) =>
    JSON.stringify(options.wakeMessage?.(session) ?? { type: "wake" });
  const forget = (peer: { id: string }) => {
    const helloTimer = helloTimers.get(peer.id);
    if (helloTimer) clearTimeout(helloTimer);
    helloTimers.delete(peer.id);
    const wasPending = pendingPeers.delete(peer.id);
    helloInFlight.delete(peer.id);
    const connection = connections.get(peer.id);
    if (connection) {
      const count = roomConnectionCounts.get(connection.session.roomId) ?? 1;
      if (count <= 1) roomConnectionCounts.delete(connection.session.roomId);
      else roomConnectionCounts.set(connection.session.roomId, count - 1);
    }
    connections.delete(peer.id);
    return { wasActive: Boolean(connection), wasPending };
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
          let parsed: unknown;
          try {
            parsed = JSON.parse(message);
          } catch {
            return;
          }
          if (!isMultiplayerRealtimeMessage(parsed)) return;
          for (const connection of connections.values()) {
            if (channelFor(connection.session) !== channel) continue;
            if (parsed.type === "terminal") {
              const playerMatches =
                !parsed.playerId || parsed.playerId === connection.session.playerId;
              const roleMatches = !parsed.role || parsed.role === connection.session.role;
              if (!playerMatches || !roleMatches) continue;
              try {
                connection.peer.send(message);
              } catch (error) {
                // A half-closed socket must not abort the loop — every other
                // player in the room still needs their terminal notice.
                log.warn("things.multiplayer", "Realtime terminal send failed", {
                  error: error instanceof Error ? error.message : String(error),
                  game: options.game,
                });
              } finally {
                terminate(
                  connection.peer,
                  MULTIPLAYER_SOCKET_CLOSE.sessionEnded,
                  parsed.reason,
                  parsed.reason,
                );
              }
              continue;
            }
            try {
              connection.peer.send(message);
            } catch (error) {
              log.warn("things.multiplayer", "Realtime socket wake failed", {
                error: error instanceof Error ? error.message : String(error),
                game: options.game,
              });
            }
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
  const publishMessage = async (session: Session, message: string) => {
    const channel = channelFor(session);
    await ensureBackplane();
    await runMultiplayerEffect(
      MultiplayerRealtimeBackplane.use((backplane) => backplane.publish(channel, message)),
    ).catch((error) =>
      log.warn("things.multiplayer", "Realtime backplane publication unavailable", {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  };
  const publishWake = (session: Session) => publishMessage(session, wakeFor(session));
  const terminate = (
    peer: {
      id: string;
      close: (code: number, reason: string) => void;
    },
    code: number,
    reason: string,
    _message: string,
  ) => {
    const { wasActive, wasPending } = forget(peer);
    terminatedPeers.set(peer.id, Date.now());
    ignoreTelemetryFailure(
      record((telemetry) => telemetry.socketClosed(options.game, reason, wasActive, wasPending)),
    );
    peer.close(code, reason);
  };

  const beginPending = (peer: { id: string; close: (code: number, reason: string) => void }) => {
    if (pendingPeers.has(peer.id) || connections.has(peer.id)) return true;
    if (
      connections.size + pendingPeers.size >=
      MULTIPLAYER_REALTIME_LIMITS.maxConnectionsPerProcess
    ) {
      terminate(
        peer,
        MULTIPLAYER_SOCKET_CLOSE.serverOverloaded,
        "server_overloaded",
        "server_overloaded",
      );
      return false;
    }
    pendingPeers.add(peer.id);
    ignoreTelemetryFailure(record((telemetry) => telemetry.socketPending(options.game)));
    const timer = setTimeout(() => {
      if (!pendingPeers.has(peer.id) || connections.has(peer.id)) return;
      terminate(peer, MULTIPLAYER_SOCKET_CLOSE.policyViolation, "hello_timeout", "hello_timeout");
    }, MULTIPLAYER_REALTIME_LIMITS.preAuthHelloTimeoutMs);
    helloTimers.set(peer.id, timer);
    return true;
  };

  const idleSweepTimer = setInterval(() => {
    const now = Date.now();
    for (const connection of connections.values()) {
      if (now - connection.lastActivityAt <= MULTIPLAYER_REALTIME_LIMITS.socketIdleTimeoutMs)
        continue;
      terminate(
        connection.peer,
        MULTIPLAYER_SOCKET_CLOSE.heartbeatTimeout,
        "heartbeat_timeout",
        "heartbeat_timeout",
      );
    }
    for (const peerId of pendingPeers) {
      if (helloTimers.has(peerId)) continue;
      // A test adapter or an unusual deployment may not call `open`; keep its
      // accounting bounded even in that case.
      pendingPeers.delete(peerId);
    }
    for (const [peerId, terminatedAt] of terminatedPeers) {
      // Normally cleared by the close/error event; a half-open socket whose
      // close handshake never arrives would otherwise pin its entry forever.
      if (now - terminatedAt > MULTIPLAYER_REALTIME_LIMITS.socketIdleTimeoutMs) {
        terminatedPeers.delete(peerId);
      }
    }
  }, MULTIPLAYER_REALTIME_LIMITS.socketIdleSweepIntervalMs);
  if (typeof idleSweepTimer === "object" && idleSweepTimer !== null && "unref" in idleSweepTimer)
    (idleSweepTimer as { unref: () => void }).unref();

  return defineWebSocketHandler({
    open(peer) {
      if (!socketOriginAllowed(peer.request)) {
        terminate(
          peer,
          MULTIPLAYER_SOCKET_CLOSE.policyViolation,
          "origin_rejected",
          "origin_rejected",
        );
        return;
      }
      beginPending(peer);
    },
    async message(peer, message) {
      if (
        !connections.has(peer.id) &&
        !pendingPeers.has(peer.id) &&
        !socketOriginAllowed(peer.request)
      ) {
        terminate(
          peer,
          MULTIPLAYER_SOCKET_CLOSE.policyViolation,
          "origin_rejected",
          "origin_rejected",
        );
        return;
      }
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
        if (!beginPending(peer)) return;
        if (helloInFlight.has(peer.id)) {
          terminate(
            peer,
            MULTIPLAYER_SOCKET_CLOSE.policyViolation,
            "hello_repeated",
            "hello_repeated",
          );
          return;
        }
        helloInFlight.add(peer.id);
        let session: Session | null;
        try {
          session = await options.authorize(payload);
        } catch (error) {
          log.warn("things.multiplayer", "Realtime authorization unavailable", {
            error: error instanceof Error ? error.message : String(error),
            game: options.game,
          });
          // A datastore or runtime blip is not bad credentials. 1013 is deliberately retryable on
          // the client, while a real null result below remains a terminal policy close.
          terminate(
            peer,
            MULTIPLAYER_SOCKET_CLOSE.serverOverloaded,
            "authorization_unavailable",
            "authorization_unavailable",
          );
          return;
        }
        if (terminatedPeers.has(peer.id)) return;
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
          lastActivityAt: Date.now(),
          lastWakeAt: 0,
          messageCount: 1,
          peer,
          rateWindowStartedAt: Date.now(),
          session,
        });
        const wasPending = pendingPeers.delete(peer.id);
        helloInFlight.delete(peer.id);
        const helloTimer = helloTimers.get(peer.id);
        if (helloTimer) clearTimeout(helloTimer);
        helloTimers.delete(peer.id);
        roomConnectionCounts.set(
          session.roomId,
          (roomConnectionCounts.get(session.roomId) ?? 0) + 1,
        );
        await record((telemetry) =>
          telemetry.socketOpened(options.game, wasPending, payload.reconnect === "1"),
        );
        peer.send(JSON.stringify({ type: "ready" }));
        await publishWake(session);
        return;
      }

      const connection = connections.get(peer.id);
      if (!connection) {
        // A frame can legitimately race the hello it follows: the client's
        // advisory sends gate on the socket being open, not on `ready`, and
        // `authorize` above is awaited. Drop the frame instead of closing
        // with a terminal code the client will never reconnect from — the
        // wake lane is advisory, so a lost frame costs one poll at most.
        if (helloInFlight.has(peer.id)) return;
        terminate(
          peer,
          MULTIPLAYER_SOCKET_CLOSE.policyViolation,
          "hello_required",
          "hello required",
        );
        return;
      }
      const now = Date.now();
      connection.lastActivityAt = now;
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
      if (isMultiplayerClientControlMessage(payload) && payload.type === "ping") {
        peer.send(JSON.stringify({ type: "pong" }));
      } else if (isMultiplayerClientControlMessage(payload) && payload.type === "changed") {
        if (now - connection.lastWakeAt < MULTIPLAYER_REALTIME_LIMITS.minimumWakeIntervalMs) return;
        connection.lastWakeAt = now;
        await publishWake(connection.session);
      } else {
        const relay = options.relayMessage?.(payload, connection.session) ?? null;
        if (!relay) {
          terminate(
            peer,
            MULTIPLAYER_SOCKET_CLOSE.policyViolation,
            "unsupported_message",
            "unsupported message",
          );
          return;
        }
        await publishMessage(connection.session, JSON.stringify(relay));
      }
    },
    close(peer) {
      if (terminatedPeers.delete(peer.id)) return;
      const { wasActive, wasPending } = forget(peer);
      ignoreTelemetryFailure(
        record((telemetry) =>
          telemetry.socketClosed(options.game, "client_closed", wasActive, wasPending),
        ),
      );
    },
    error(peer) {
      if (terminatedPeers.delete(peer.id)) return;
      const { wasActive, wasPending } = forget(peer);
      ignoreTelemetryFailure(
        record((telemetry) =>
          telemetry.socketClosed(options.game, "socket_error", wasActive, wasPending),
        ),
      );
    },
  });
}
