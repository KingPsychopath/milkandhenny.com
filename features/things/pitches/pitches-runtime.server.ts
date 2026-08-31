import { Effect } from "effect";

import { runEffectResult, type EffectRunResult } from "@/lib/platform/effect-boundary.server";
import { makeManagedRuntimeHost } from "@/lib/platform/managed-runtime.server";
import { PitchesService } from "./pitches-service.server";

const pitchesRuntime = makeManagedRuntimeHost(PitchesService.layer, "Pitches");

export function runPitchesEffect<A, E>(
  effect: Effect.Effect<A, E, PitchesService>,
  signal?: AbortSignal,
) {
  return pitchesRuntime.run(effect, signal);
}

export function disposePitchesRuntime() {
  return pitchesRuntime.dispose();
}

export async function runPitchesResult<A, E>(
  effect: Effect.Effect<A, E, PitchesService>,
  signal?: AbortSignal,
): Promise<EffectRunResult<A>> {
  return runEffectResult(() => runPitchesEffect(effect, signal));
}
