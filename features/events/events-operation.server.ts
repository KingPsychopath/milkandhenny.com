import { Effect } from "effect";

import { log } from "@/lib/platform/logger.server";
import { EventsOperationError, type EventsDomain } from "./events-errors.server";

interface EventsOperationOptions {
  domain: EventsDomain;
  operation: string;
  /** `false` opts out entirely; used where a caller supplies its own bound. */
  timeoutMs?: false | number;
}

/**
 * Wrap an async engine call as a traced, bounded, typed Effect.
 *
 * Mirrors `multiplayerOperation`: engines stay plain async functions and
 * Effect is applied at the service boundary. The door is the reason the
 * default timeout is short — a scan that hangs is worse than a scan that
 * fails, because staff can retry a failure in a second.
 */
export function eventsOperation<A>(
  options: EventsOperationOptions,
  run: (signal: AbortSignal) => Promise<A>,
) {
  const attempted = Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new EventsOperationError({
        cause,
        domain: options.domain,
        operation: options.operation,
        retryable: false,
      }),
  });

  return (
    options.timeoutMs === false
      ? attempted
      : attempted.pipe(Effect.timeout(options.timeoutMs ?? 6_000))
  ).pipe(
    Effect.mapError((cause) =>
      cause instanceof EventsOperationError
        ? cause
        : new EventsOperationError({
            cause,
            domain: options.domain,
            operation: options.operation,
            // Anything that is not our own tagged error reached us from the
            // timeout combinator, which is worth retrying.
            retryable: true,
          }),
    ),
    Effect.tapError((error) =>
      Effect.sync(() => {
        log.error(
          options.domain,
          "Operation failed",
          { operation: options.operation, retryable: error.retryable },
          error.cause,
        );
      }),
    ),
    Effect.withSpan(`${options.domain}.${options.operation}`, {
      attributes: { domain: options.domain, operation: options.operation },
    }),
  );
}
