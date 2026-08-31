import { Effect } from "effect";

import { effectOperation, type OperationKind } from "@/lib/platform/effect-boundary.server";
import { log } from "@/lib/platform/logger.server";
import { EventsOperationError, type EventsDomain } from "./events-errors.server";

interface EventsOperationOptions {
  domain: EventsDomain;
  operation: string;
  kind?: OperationKind;
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
  const kind = options.kind ?? "read";
  return effectOperation({
    kind,
    run,
    timeoutMs: options.timeoutMs ?? 6_000,
    isMappedError: (cause): cause is EventsOperationError => cause instanceof EventsOperationError,
    mapError: (details) =>
      new EventsOperationError({
        ...details,
        domain: options.domain,
        operation: options.operation,
      }),
  }).pipe(
    Effect.tapError((error) =>
      Effect.sync(() => {
        log.error(
          options.domain,
          "Operation failed",
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
    Effect.withSpan(`${options.domain}.${options.operation}`, {
      attributes: { domain: options.domain, operation: options.operation, operationKind: kind },
    }),
  );
}
