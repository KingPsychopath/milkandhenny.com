import { Effect } from "effect";

import { log } from "@/lib/platform/logger.server";
import {
  assertPitchOperationAllowed,
  PitchOperationBlockedError,
  type PitchOperationAccess,
} from "./operational.server";
import { PitchesOperationError } from "./pitches-errors.server";

export function pitchesOperation<A>(
  operation: string,
  run: (signal: AbortSignal) => Promise<A>,
  options: { access: PitchOperationAccess; timeoutMs?: false | number },
) {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const attempted = Effect.tryPromise({
    try: async (signal) => {
      await assertPitchOperationAllowed(options.access);
      return run(signal);
    },
    catch: (cause) =>
      new PitchesOperationError({
        cause,
        operation,
        retryable: false,
        status: cause instanceof PitchOperationBlockedError ? cause.status : undefined,
        publicMessage: cause instanceof PitchOperationBlockedError ? cause.message : undefined,
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
        if (error.cause instanceof PitchOperationBlockedError) return;
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
