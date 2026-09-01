import { Effect } from "effect";

import { effectOperation, type OperationKind } from "@/lib/platform/effect-boundary.server";
import { log } from "@/lib/platform/logger.server";
import { StaffAccessOperationError } from "./staff-access-errors.server";

export function staffAccessOperation<A>(
  operation: string,
  kind: OperationKind,
  run: (signal: AbortSignal) => Promise<A>,
) {
  return effectOperation({
    kind,
    run,
    timeoutMs: 8_000,
    isMappedError: (cause): cause is StaffAccessOperationError =>
      cause instanceof StaffAccessOperationError,
    mapError: (details) => {
      const cause = details.cause;
      const explicitStatus =
        cause && typeof cause === "object" && "status" in cause && typeof cause.status === "number"
          ? cause.status
          : undefined;
      const safeDomainMessage =
        cause instanceof Error &&
        /required|invalid|already|unavailable|expired|event end|verified identity/i.test(
          cause.message,
        )
          ? cause.message
          : undefined;
      return new StaffAccessOperationError({
        ...details,
        operation,
        status: explicitStatus ?? (safeDomainMessage ? 400 : undefined),
        publicMessage: safeDomainMessage,
      });
    },
  }).pipe(
    Effect.tapError((error) =>
      Effect.sync(() =>
        log.error(
          "event-staff",
          "Operation failed",
          {
            operation,
            classification: error.classification,
            retryable: error.retryable,
            outcome: error.outcome,
          },
          error.cause,
        ),
      ),
    ),
    Effect.withSpan(`event-staff.${operation}`, {
      attributes: { domain: "event-staff", operation, operationKind: kind },
    }),
  );
}
