import { Effect, Layer } from "effect";

import { runEffectResult, type EffectRunResult } from "@/lib/platform/effect-boundary.server";
import { makeManagedRuntimeHost } from "@/lib/platform/managed-runtime.server";
import { ObjectStorageService } from "@/lib/platform/provider-services.server";
import { PitchesService } from "./pitches-service.server";

const pitchesLayer = Layer.mergeAll(PitchesService.layer, ObjectStorageService.layer);
const pitchesRuntime = makeManagedRuntimeHost(pitchesLayer, "Pitches");

export function runPitchesEffect<A, E>(
  effect: Effect.Effect<A, E, PitchesService | ObjectStorageService>,
  signal?: AbortSignal,
) {
  return pitchesRuntime.run(effect, signal);
}

export function disposePitchesRuntime() {
  return pitchesRuntime.dispose();
}

export async function runPitchesResult<A, E>(
  effect: Effect.Effect<A, E, PitchesService | ObjectStorageService>,
  signal?: AbortSignal,
): Promise<EffectRunResult<A>> {
  return runEffectResult(() => runPitchesEffect(effect, signal));
}
