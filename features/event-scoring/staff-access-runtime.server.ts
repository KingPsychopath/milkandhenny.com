import { Effect } from "effect";

import { runEffectResult, type EffectRunResult } from "@/lib/platform/effect-boundary.server";
import { disposeEventsRuntime, runEventsEffect } from "@/features/events/events-runtime.server";
import { StaffAccessService } from "./staff-access-service.server";

export function runStaffAccessEffect<A, E>(
  effect: Effect.Effect<A, E, StaffAccessService>,
  signal?: AbortSignal,
) {
  return runEventsEffect(effect, signal);
}

export function runStaffAccessResult<A, E>(
  effect: Effect.Effect<A, E, StaffAccessService>,
  signal?: AbortSignal,
): Promise<EffectRunResult<A>> {
  return runEffectResult(() => runStaffAccessEffect(effect, signal));
}

export function disposeStaffAccessRuntime() {
  return disposeEventsRuntime();
}
