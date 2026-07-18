import { Effect } from "effect";

import { log } from "@/lib/platform/logger.server";

import { MultiplayerOperationError } from "./multiplayer-errors.server";
import { MultiplayerTelemetry } from "./multiplayer-telemetry.server";
import type { MultiplayerGame } from "./multiplayer-telemetry";

interface MultiplayerOperationOptions {
  game: MultiplayerGame;
  operation: string;
  reconciliation?: boolean;
  timeoutMs?: false | number;
}

export function multiplayerOperation<A>(
  options: MultiplayerOperationOptions,
  run: (signal: AbortSignal) => Promise<A>,
) {
  return Effect.gen(function* () {
    const telemetry = yield* MultiplayerTelemetry;
    const startedAt = performance.now();
    const attempted = Effect.tryPromise({
      try: run,
      catch: (cause) =>
        new MultiplayerOperationError({
          cause,
          game: options.game,
          operation: options.operation,
          retryable: false,
        }),
    });
    const operation = (
      options.timeoutMs === false
        ? attempted
        : attempted.pipe(Effect.timeout(options.timeoutMs ?? 8_000))
    ).pipe(
      Effect.mapError((cause) =>
        cause instanceof MultiplayerOperationError
          ? cause
          : new MultiplayerOperationError({
              cause,
              game: options.game,
              operation: options.operation,
              retryable: true,
            }),
      ),
      Effect.tapError((error) =>
        Effect.sync(() => {
          log.error(
            `things.${options.game}`,
            "Multiplayer operation failed",
            { operation: options.operation, retryable: error.retryable },
            error.cause,
          );
        }),
      ),
      Effect.tap(() =>
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
      attributes: { game: options.game, operation: options.operation },
    }),
  );
}
