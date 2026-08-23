import { Effect, ManagedRuntime } from "effect";

import { PitchesService } from "./pitches-service.server";

const pitchesRuntime = ManagedRuntime.make(PitchesService.layer);

export function runPitchesEffect<A, E>(
  effect: Effect.Effect<A, E, PitchesService>,
  signal?: AbortSignal,
) {
  return pitchesRuntime.runPromise(effect, signal ? { signal } : undefined);
}

export function disposePitchesRuntime() {
  return pitchesRuntime.dispose();
}

export async function runPitchesResult<A, E>(
  effect: Effect.Effect<A, E, PitchesService>,
  signal?: AbortSignal,
): Promise<
  { ok: true; value: A } | { ok: false; status: number; error: string; retryable: boolean }
> {
  try {
    return { ok: true, value: await runPitchesEffect(effect, signal) };
  } catch (error) {
    const retryable =
      typeof error === "object" &&
      error !== null &&
      "retryable" in error &&
      (error as { retryable: unknown }).retryable === true;
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : retryable
          ? 503
          : 500;
    const publicMessage =
      typeof error === "object" &&
      error !== null &&
      "publicMessage" in error &&
      typeof (error as { publicMessage?: unknown }).publicMessage === "string"
        ? (error as { publicMessage: string }).publicMessage
        : retryable
          ? "That took too long. Try again."
          : "The studio could not complete that action. Try again.";
    return {
      ok: false,
      status,
      error: publicMessage,
      retryable,
    };
  }
}
