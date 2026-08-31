import { Effect } from "effect";

import { effectOperation, type OperationKind } from "@/lib/platform/effect-boundary.server";
import { log } from "@/lib/platform/logger.server";

import { MultiplayerOperationError } from "./multiplayer-errors.server";
import type { GameContext } from "./game-engine";
import { makeGameContext } from "./game-workflow-services.server";
import { gameRealtimeChannel } from "./multiplayer-keys";
import { MultiplayerRealtimeBackplane } from "./multiplayer-realtime-backplane.server";
import { MultiplayerTelemetry } from "./multiplayer-telemetry.server";
import { MULTIPLAYER_GAME_REGISTRY, type MultiplayerGame } from "./multiplayer-telemetry";

interface MultiplayerOperationOptions {
  game: MultiplayerGame;
  operation: string;
  kind?: OperationKind;
  reconciliation?: boolean;
  timeoutMs?: false | number;
  wakeRoomId?: string;
}

export function multiplayerOperation<A>(
  options: MultiplayerOperationOptions,
  run: (signal: AbortSignal) => Promise<A>,
  wakeWhen: (result: A) => boolean = () => true,
) {
  const kind =
    options.kind ?? (/^(read_|authorize_|get_)/.test(options.operation) ? "read" : "mutation");
  return Effect.gen(function* () {
    const telemetry = yield* MultiplayerTelemetry;
    const startedAt = performance.now();
    const operation = effectOperation({
      kind,
      run,
      timeoutMs: options.timeoutMs ?? 8_000,
      isMappedError: (cause): cause is MultiplayerOperationError =>
        cause instanceof MultiplayerOperationError,
      mapError: (details) =>
        new MultiplayerOperationError({
          ...details,
          game: options.game,
          operation: options.operation,
        }),
    }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          log.error(
            `things.${options.game}`,
            "Multiplayer operation failed",
            {
              classification: error.classification,
              operation: options.operation,
              outcome: error.outcome,
              retryable: error.retryable,
            },
            error.cause,
          );
        }),
      ),
      Effect.tap((result) =>
        Effect.gen(function* () {
          const durationMs = performance.now() - startedAt;
          yield* telemetry.recordOperation({
            durationMs,
            game: options.game,
            operation: options.operation,
            result: "success",
          });
          if (options.reconciliation)
            yield* telemetry.recordReconciliation(options.game, durationMs);
          if (options.wakeRoomId && wakeWhen(result)) {
            const backplane = yield* MultiplayerRealtimeBackplane;
            const version = Number(MULTIPLAYER_GAME_REGISTRY[options.game].channelVersion.slice(1));
            yield* backplane.publish(
              gameRealtimeChannel(options.game, version, options.wakeRoomId),
              JSON.stringify({ type: "wake" }),
            );
          }
        }),
      ),
      Effect.tapError(() =>
        telemetry.recordOperation({
          durationMs: performance.now() - startedAt,
          game: options.game,
          operation: options.operation,
          result: "failure",
        }),
      ),
    );
    return yield* operation;
  }).pipe(
    Effect.withSpan(`multiplayer.${options.game}.${options.operation}`, {
      attributes: {
        game: options.game,
        operation: options.operation,
        operationKind: kind,
      },
    }),
  );
}

export function multiplayerCommand<A>(
  options: MultiplayerOperationOptions,
  run: (signal: AbortSignal, context: GameContext) => Promise<A>,
  wakeWhen?: (result: A) => boolean,
) {
  return makeGameContext().pipe(
    Effect.flatMap((context) =>
      multiplayerOperation(
        { ...options, kind: options.kind ?? "idempotent-mutation" },
        (signal) => run(signal, context),
        wakeWhen,
      ),
    ),
  );
}
