import { Effect, Layer, ManagedRuntime } from "effect";

import { activeRequestSignal } from "@/lib/http/request-signal.server";
import { createRuntimeLifecycle } from "./runtime-lifecycle.server";

/**
 * Owns the complete lifecycle of one subsystem runtime. ManagedRuntime builds its layer lazily,
 * memoizes the resulting services, tracks fibers started through it, and releases the layer scope
 * during disposal; this host adds request cancellation and rejects new work once shutdown begins.
 */
export function makeManagedRuntimeHost<R, ER>(layer: Layer.Layer<R, ER, never>, label: string) {
  const runtime = ManagedRuntime.make(layer);
  const lifecycle = createRuntimeLifecycle(() => runtime.dispose(), label);

  return {
    dispose: () => lifecycle.dispose(),
    run<A, E>(effect: Effect.Effect<A, E, R>, signal?: AbortSignal): Promise<A> {
      const cancellation = signal ?? activeRequestSignal();
      return lifecycle.run(() =>
        runtime.runPromise(effect, cancellation ? { signal: cancellation } : undefined),
      );
    },
    state: lifecycle.state,
  };
}

export type ManagedRuntimeHost<R, ER = never> = ReturnType<typeof makeManagedRuntimeHost<R, ER>>;
