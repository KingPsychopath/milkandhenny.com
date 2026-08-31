import { Effect } from "effect";

import { withOperationSignal } from "./operation-context.server";

export type FailureClassification = "domain" | "transient" | "timeout" | "interruption" | "defect";

export type OperationKind = "read" | "mutation" | "idempotent-mutation" | "advisory";

export type EffectRunResult<A> =
  | { ok: true; value: A }
  | {
      ok: false;
      status: number;
      error: string;
      retryable: boolean;
      classification: FailureClassification;
      outcome: "known" | "uncertain";
    };

export interface OperationFailureDetails {
  cause: unknown;
  classification: FailureClassification;
  outcome: "known" | "uncertain";
  retryable: boolean;
}

const TRANSIENT_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ETIMEDOUT",
  "57P01",
  "57P02",
  "57P03",
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
]);

function property(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

export function classifyFailure(cause: unknown): FailureClassification {
  const declared = property(cause, "classification");
  if (
    declared === "domain" ||
    declared === "transient" ||
    declared === "timeout" ||
    declared === "interruption" ||
    declared === "defect"
  )
    return declared;

  const tag = property(cause, "_tag");
  const name = property(cause, "name");
  const message = property(cause, "message");
  if (tag === "TimeoutException" || name === "TimeoutError") return "timeout";
  if (
    tag === "InterruptedException" ||
    name === "AbortError" ||
    name === "InterruptedException" ||
    message === "All fibers interrupted without error"
  )
    return "interruption";

  if (name === "DatabaseUnavailableError") return "transient";

  const status = property(cause, "status") ?? property(cause, "statusCode");
  if (typeof status === "number") {
    if (status === 408 || status === 425 || status === 429 || status >= 500) return "transient";
    if (status >= 400) return "domain";
  }

  const code = property(cause, "code");
  if (typeof code === "string") {
    if (
      TRANSIENT_CODES.has(code) ||
      code.startsWith("08") ||
      code === "40001" ||
      code === "40P01" ||
      code === "53300"
    )
      return "transient";
  }

  const nested = property(cause, "cause");
  if (nested !== undefined && nested !== cause) {
    const nestedClassification = classifyFailure(nested);
    if (nestedClassification !== "defect") return nestedClassification;
  }

  return "defect";
}

export function retryableFor(classification: FailureClassification, kind: OperationKind): boolean {
  if (classification !== "timeout" && classification !== "transient") return false;
  return kind === "read" || kind === "idempotent-mutation" || kind === "advisory";
}

export function operationFailureDetails(
  cause: unknown,
  kind: OperationKind,
  classify: (cause: unknown) => FailureClassification = classifyFailure,
): OperationFailureDetails {
  const classification = classify(cause);
  const mutation = kind === "mutation" || kind === "idempotent-mutation";
  return {
    cause,
    classification,
    outcome:
      mutation &&
      (classification === "timeout" ||
        classification === "interruption" ||
        classification === "transient")
        ? "uncertain"
        : "known",
    retryable: retryableFor(classification, kind),
  };
}

/**
 * The shared boundary from interruptible Effect work into an existing Promise-based engine.
 * Timeout and cancellation semantics live here so every subsystem classifies the same failure in
 * the same way and exposes Effect's AbortSignal to the adapters below it.
 */
export function effectOperation<A, E>(options: {
  classify?: (cause: unknown) => FailureClassification;
  isMappedError: (cause: unknown) => cause is E;
  kind: OperationKind;
  mapError: (details: OperationFailureDetails) => E;
  run: (signal: AbortSignal) => Promise<A>;
  timeoutMs: false | number;
}) {
  const details = (cause: unknown) =>
    operationFailureDetails(cause, options.kind, options.classify);
  const attempted = Effect.tryPromise({
    try: (signal) => withOperationSignal(signal, () => options.run(signal)),
    catch: (cause) => options.mapError(details(cause)),
  });
  const bounded =
    options.timeoutMs === false ? attempted : attempted.pipe(Effect.timeout(options.timeoutMs));
  return bounded.pipe(
    Effect.mapError((cause) =>
      options.isMappedError(cause) ? cause : options.mapError(details(cause)),
    ),
  );
}

export function transportFailure(error: unknown): EffectRunResult<never> {
  const classification = classifyFailure(error);
  const retryable = property(error, "retryable") === true;
  const outcome =
    property(error, "outcome") === "uncertain" || classification === "interruption"
      ? "uncertain"
      : "known";
  const explicitStatus = property(error, "status");
  const status =
    typeof explicitStatus === "number"
      ? explicitStatus
      : classification === "domain"
        ? 400
        : classification === "interruption"
          ? 499
          : classification === "timeout"
            ? 504
            : classification === "transient"
              ? 503
              : 500;
  const explicitMessage = property(error, "publicMessage");
  const publicMessage =
    typeof explicitMessage === "string"
      ? explicitMessage
      : outcome === "uncertain"
        ? "The request ended before completion was confirmed. Refresh before trying again."
        : classification === "interruption"
          ? "The request was cancelled."
          : retryable
            ? "The service is temporarily unavailable. Try again."
            : "Something went wrong.";
  return {
    ok: false,
    status,
    error: publicMessage,
    retryable,
    classification,
    outcome,
  };
}

export async function runEffectResult<A>(run: () => Promise<A>): Promise<EffectRunResult<A>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return transportFailure(error);
  }
}
