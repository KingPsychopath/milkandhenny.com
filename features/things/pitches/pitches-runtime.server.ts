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
    return {
      ok: false,
      status: retryable ? 503 : 500,
      error: retryable ? "That took too long. Try again." : "Something went wrong.",
      retryable,
    };
  }
}
