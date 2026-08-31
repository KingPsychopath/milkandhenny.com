import { Effect } from "effect";

import {
  classifyFailure,
  effectOperation,
  type OperationKind,
} from "@/lib/platform/effect-boundary.server";
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
  options: { access: PitchOperationAccess; kind?: OperationKind; timeoutMs?: false | number },
) {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const kind = options.kind ?? "mutation";
  return effectOperation({
    kind,
    timeoutMs,
    run: async (signal) => {
      await assertPitchOperationAllowed(options.access);
      return run(signal);
    },
    classify: (cause) =>
      cause instanceof PitchOperationBlockedError ? "domain" : classifyFailure(cause),
    isMappedError: (cause): cause is PitchesOperationError =>
      cause instanceof PitchesOperationError,
    mapError: (details) =>
      new PitchesOperationError({
        ...details,
        operation,
        status:
          details.cause instanceof PitchOperationBlockedError ? details.cause.status : undefined,
        publicMessage:
          details.cause instanceof PitchOperationBlockedError ? details.cause.message : undefined,
      }),
  }).pipe(
    Effect.tapError((error) =>
      Effect.sync(() => {
        if (error.cause instanceof PitchOperationBlockedError) return;
        log.error(
          "pitches",
          "Operation failed",
          {
            classification: error.classification,
            operation,
            outcome: error.outcome,
            retryable: error.retryable,
          },
          error.cause,
        );
      }),
    ),
    Effect.withSpan(`pitches.${operation}`, {
      attributes: { domain: "pitches", operation, operationKind: kind },
    }),
  );
}
