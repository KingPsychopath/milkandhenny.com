import { Context, Effect, Layer, Metric } from "effect";

import { getRuntimeInstanceId } from "@/lib/platform/runtime-metadata.server";

import type {
  MultiplayerGame,
  MultiplayerLatencySnapshot,
  MultiplayerTelemetrySnapshot,
} from "./multiplayer-telemetry";

type OperationResult = "failure" | "success";

const operationCounter = Metric.counter("multiplayer_operations_total", {
  description: "Multiplayer server operations completed",
  incremental: true,
});
const operationDuration = Metric.histogram("multiplayer_operation_duration_ms", {
  description: "Multiplayer server operation latency",
  boundaries: [5, 10, 20, 40, 80, 160, 320, 640, 1_250, 2_500, 5_000],
});
const activeSockets = Metric.gauge("multiplayer_active_sockets", {
  description: "Authenticated multiplayer sockets on this replica",
});
const rateLimitCounter = Metric.counter("multiplayer_rate_limit_total", {
  description: "Multiplayer rate limits enforced",
  incremental: true,
});
const socketTerminationCounter = Metric.counter("multiplayer_socket_termination_total", {
  description: "Multiplayer sockets terminated by bounded reason",
  incremental: true,
});
const reconciliationDuration = Metric.histogram("multiplayer_reconciliation_duration_ms", {
  description: "Authoritative multiplayer reconciliation latency",
  boundaries: [5, 10, 20, 40, 80, 160, 320, 640, 1_250, 2_500, 5_000],
});
const lockCounter = Metric.counter("multiplayer_party_lock_total", {
  description: "Spelling Party distributed lock outcomes",
  incremental: true,
});
const lockWaitDuration = Metric.histogram("multiplayer_party_lock_wait_ms", {
  description: "Spelling Party distributed lock acquisition latency",
  boundaries: [1, 5, 10, 20, 40, 80, 160, 320, 640],
});
const backplaneCounter = Metric.counter("multiplayer_realtime_backplane_total", {
  description: "Cross-replica realtime backplane events",
  incremental: true,
});

const SOCKET_REASONS = [
  "client_closed",
  "hello_repeated",
  "hello_required",
  "invalid_message",
  "message_rate",
  "message_too_large",
  "server_overloaded",
  "socket_error",
  "unauthorized",
  "unsupported_message",
] as const;

type SocketTerminationReason = (typeof SOCKET_REASONS)[number];

function gameMetric<Input, State>(metric: Metric.Metric<Input, State>, game: MultiplayerGame) {
  return Metric.withAttributes(metric, { game });
}

function latencySnapshot(state: Metric.HistogramState): MultiplayerLatencySnapshot {
  return {
    samples: state.count,
    averageMs: state.count === 0 ? null : Math.round((state.sum / state.count) * 10) / 10,
    maxMs:
      state.count === 0 || !Number.isFinite(state.max) ? null : Math.round(state.max * 10) / 10,
  };
}

function boundedSocketReason(reason: string): SocketTerminationReason {
  return SOCKET_REASONS.includes(reason as SocketTerminationReason)
    ? (reason as SocketTerminationReason)
    : "socket_error";
}

export class MultiplayerTelemetry extends Context.Service<
  MultiplayerTelemetry,
  {
    readonly recordLock: (input: {
      acquired: boolean;
      contended: boolean;
      waitMs: number;
    }) => Effect.Effect<void>;
    readonly recordBackplane: (
      direction: "publish" | "receive",
      outcome: "failure" | "success",
    ) => Effect.Effect<void>;
    readonly recordOperation: (input: {
      durationMs: number;
      game: MultiplayerGame;
      operation: string;
      result: OperationResult;
    }) => Effect.Effect<void>;
    readonly recordRateLimit: (game: MultiplayerGame, source: string) => Effect.Effect<void>;
    readonly recordReconciliation: (
      game: MultiplayerGame,
      durationMs: number,
    ) => Effect.Effect<void>;
    readonly socketClosed: (
      game: MultiplayerGame,
      reason: string,
      wasActive: boolean,
    ) => Effect.Effect<void>;
    readonly socketOpened: (game: MultiplayerGame) => Effect.Effect<void>;
    readonly setBackplaneMode: (mode: "local" | "redis") => Effect.Effect<void>;
    readonly snapshot: Effect.Effect<MultiplayerTelemetrySnapshot>;
  }
>()("MultiplayerTelemetry") {
  static readonly layer = Layer.sync(this, () => {
    let backplaneMode: "local" | "redis" = "local";
    const runtimeStartedAt = new Date().toISOString();
    const replica = getRuntimeInstanceId();

    return {
      recordBackplane: (direction, outcome) =>
        Metric.update(Metric.withAttributes(backplaneCounter, { direction, outcome }), 1),
      recordLock: ({ acquired, contended, waitMs }) =>
        Effect.all(
          [
            Metric.update(
              Metric.withAttributes(lockCounter, {
                outcome: acquired ? "acquired" : "failed",
              }),
              1,
            ),
            ...(contended
              ? [Metric.update(Metric.withAttributes(lockCounter, { outcome: "contended" }), 1)]
              : []),
            Metric.update(lockWaitDuration, Math.max(0, waitMs)),
          ],
          { discard: true },
        ),
      recordOperation: ({ durationMs, game, operation, result }) =>
        Effect.all(
          [
            Metric.update(Metric.withAttributes(operationCounter, { game, result }), 1),
            Metric.update(
              Metric.withAttributes(operationDuration, { game, operation }),
              Math.max(0, durationMs),
            ),
          ],
          { discard: true },
        ),
      recordRateLimit: (game, _source) =>
        Metric.update(Metric.withAttributes(rateLimitCounter, { game }), 1),
      recordReconciliation: (game, durationMs) =>
        Metric.update(gameMetric(reconciliationDuration, game), Math.max(0, durationMs)),
      socketClosed: (game, reason, wasActive) =>
        Effect.all(
          [
            ...(wasActive ? [Metric.modify(gameMetric(activeSockets, game), -1)] : []),
            Metric.update(
              Metric.withAttributes(socketTerminationCounter, {
                game,
                reason: boundedSocketReason(reason),
              }),
              1,
            ),
          ],
          { discard: true },
        ),
      socketOpened: (game) => Metric.modify(gameMetric(activeSockets, game), 1),
      setBackplaneMode: (mode) =>
        Effect.sync(() => {
          backplaneMode = mode;
        }),
      snapshot: Effect.gen(function* () {
        const games = {} as MultiplayerTelemetrySnapshot["games"];
        for (const game of ["remote", "spelling-party", "draw-country"] as const) {
          const [active, success, failure, limited, reconciliation] = yield* Effect.all([
            Metric.value(gameMetric(activeSockets, game)),
            Metric.value(Metric.withAttributes(operationCounter, { game, result: "success" })),
            Metric.value(Metric.withAttributes(operationCounter, { game, result: "failure" })),
            Metric.value(gameMetric(rateLimitCounter, game)),
            Metric.value(gameMetric(reconciliationDuration, game)),
          ]);
          const socketTerminations: Record<string, number> = {};
          for (const reason of SOCKET_REASONS) {
            const state = yield* Metric.value(
              Metric.withAttributes(socketTerminationCounter, { game, reason }),
            );
            if (state.count > 0) socketTerminations[reason] = state.count;
          }
          games[game] = {
            activeSockets: Math.max(0, active.value),
            operations: success.count + failure.count,
            operationFailures: failure.count,
            rateLimited: limited.count,
            reconciliation: latencySnapshot(reconciliation),
            socketTerminations,
          };
        }
        const [lockAcquired, lockContended, lockFailed, lockWait] = yield* Effect.all([
          Metric.value(Metric.withAttributes(lockCounter, { outcome: "acquired" })),
          Metric.value(Metric.withAttributes(lockCounter, { outcome: "contended" })),
          Metric.value(Metric.withAttributes(lockCounter, { outcome: "failed" })),
          Metric.value(lockWaitDuration),
        ]);
        const [published, received, publishFailures, receiveFailures] = yield* Effect.all([
          Metric.value(
            Metric.withAttributes(backplaneCounter, {
              direction: "publish",
              outcome: "success",
            }),
          ),
          Metric.value(
            Metric.withAttributes(backplaneCounter, {
              direction: "receive",
              outcome: "success",
            }),
          ),
          Metric.value(
            Metric.withAttributes(backplaneCounter, {
              direction: "publish",
              outcome: "failure",
            }),
          ),
          Metric.value(
            Metric.withAttributes(backplaneCounter, {
              direction: "receive",
              outcome: "failure",
            }),
          ),
        ]);
        return {
          backplane: {
            failures: publishFailures.count + receiveFailures.count,
            mode: backplaneMode,
            published: published.count,
            received: received.count,
          },
          capturedAt: new Date().toISOString(),
          runtimeStartedAt,
          replica,
          games,
          partyRoomLock: {
            acquisitions: lockAcquired.count,
            contention: lockContended.count,
            failures: lockFailed.count,
            wait: latencySnapshot(lockWait),
          },
        };
      }),
    };
  });
}
