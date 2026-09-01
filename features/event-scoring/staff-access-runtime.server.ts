import { Effect } from "effect";

import { runEffectResult, type EffectRunResult } from "@/lib/platform/effect-boundary.server";
import { makeManagedRuntimeHost } from "@/lib/platform/managed-runtime.server";
import { StaffAccessService } from "./staff-access-service.server";

const staffAccessRuntime = makeManagedRuntimeHost(StaffAccessService.layer, "EventStaffAccess");

export function runStaffAccessEffect<A, E>(
  effect: Effect.Effect<A, E, StaffAccessService>,
  signal?: AbortSignal,
) {
  return staffAccessRuntime.run(effect, signal);
}

export function runStaffAccessResult<A, E>(
  effect: Effect.Effect<A, E, StaffAccessService>,
  signal?: AbortSignal,
): Promise<EffectRunResult<A>> {
  return runEffectResult(() => runStaffAccessEffect(effect, signal));
}

export function disposeStaffAccessRuntime() {
  return staffAccessRuntime.dispose();
}
