import { Effect } from "effect";

import { log } from "@/lib/platform/logger.server";
import { PitchesOperationError } from "./pitches-errors.server";

export function pitchesOperation<A>(
  operation: string,
  run: (signal: AbortSignal) => Promise<A>,
  timeoutMs: false | number = 8_000,
) {
  const attempted = Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new PitchesOperationError({
        cause,
        operation,
        retryable: false,
      }),
  });

  return (timeoutMs === false ? attempted : attempted.pipe(Effect.timeout(timeoutMs))).pipe(
    Effect.mapError((cause) =>
      cause instanceof PitchesOperationError
        ? cause
        : new PitchesOperationError({
            cause,
            operation,
            retryable: true,
          }),
    ),
    Effect.tapError((error) =>
      Effect.sync(() => {
        log.error(
          "pitches",
          "Operation failed",
          { operation, retryable: error.retryable },
          error.cause,
        );
      }),
    ),
    Effect.withSpan(`pitches.${operation}`, {
      attributes: { domain: "pitches", operation },
    }),
  );
}
