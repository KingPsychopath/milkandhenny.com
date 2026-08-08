import { Effect, Layer, ManagedRuntime } from "effect";

import { PairedGameRoomService } from "../remote/paired-game-room-service.server";
import { PartyRoomService } from "../spelling-party/party-room-service.server";
import { DrawCountryRoomService } from "../draw-country/draw-country-room-service.server";
import { LiarsRoomService } from "../liars/liars-room-service.server";
import { MultiplayerTelemetry } from "./multiplayer-telemetry.server";
import { MultiplayerRealtimeBackplane } from "./multiplayer-realtime-backplane.server";

const multiplayerLayer = Layer.mergeAll(
  MultiplayerTelemetry.layer,
  PairedGameRoomService.layer,
  PartyRoomService.layer.pipe(Layer.provide(MultiplayerTelemetry.layer)),
  DrawCountryRoomService.layer,
  LiarsRoomService.layer.pipe(Layer.provide(MultiplayerTelemetry.layer)),
  MultiplayerRealtimeBackplane.layer.pipe(Layer.provide(MultiplayerTelemetry.layer)),
);

/**
 * One runtime per process, held on `globalThis` rather than in module scope.
 *
 * The backplane layer opens two live Redis connections when it builds — a publisher and a
 * subscriber. In dev, Vite evaluates server modules in two graphs and re-evaluates them on every
 * hot reload, and a module-scoped runtime meant a fresh `ManagedRuntime` each time: two more
 * sockets opened, and the previous runtime dropped on the floor without ever being disposed. An
 * afternoon of editing left a long tail of orphaned connections that Upstash eventually closed
 * from its end, which is what every `Realtime publisher error: read ECONNRESET` in the dev log
 * actually was — abandoned sockets being cleaned up, not the live one failing.
 *
 * This is the same fix, and the same reason, as `createMemoryRoomStore`: in dev the module graph
 * is not the process, so anything holding a real resource has to outlive the module. Production
 * evaluates once and never notices the difference.
 *
 * Caching alone was half a fix, though, and the half it got wrong was the one you notice: a cached
 * runtime is never rebuilt, so edits to any engine behind these services stopped taking effect
 * until the dev server was restarted. Trading "leaks connections" for "silently serves stale code"
 * is not a trade worth making.
 *
 * So: replace on re-evaluation. If a runtime is already parked here when this module runs again,
 * that only happens because something in its graph changed — which is exactly when the old one
 * should be torn down and a new one built against the new code. One live runtime at a time, no
 * orphaned sockets, and no stale engine.
 *
 * `import.meta.hot.dispose` looks like the tidier hook and does not work here: it is truthy in this
 * module and never invoked, because Vite's SSR runner re-imports server modules rather than doing
 * client-style hot replacement. Verified rather than assumed — a probe logged the re-evaluation and
 * the callback that never came. Module evaluation is the only reliable signal on this side.
 */
const RUNTIME_KEY = "__milkandhenny_multiplayer_runtime__";

const runtimeHolder = globalThis as Record<string, unknown>;

if (import.meta.hot) {
  const outgoing = runtimeHolder[RUNTIME_KEY] as
    | ManagedRuntime.ManagedRuntime<MultiplayerServices, never>
    | undefined;
  // Fire and forget: nothing is waiting on it, and a failed teardown of a runtime already being
  // thrown away is not worth taking the dev server down for.
  if (outgoing) void outgoing.dispose().catch(() => undefined);
  runtimeHolder[RUNTIME_KEY] = ManagedRuntime.make(multiplayerLayer);
} else {
  // Production evaluates once, so this is a plain module-scoped singleton with extra steps.
  runtimeHolder[RUNTIME_KEY] ??= ManagedRuntime.make(multiplayerLayer);
}

const multiplayerRuntime = runtimeHolder[RUNTIME_KEY] as ManagedRuntime.ManagedRuntime<
  MultiplayerServices,
  never
>;

type MultiplayerServices =
  | MultiplayerTelemetry
  | MultiplayerRealtimeBackplane
  | PairedGameRoomService
  | PartyRoomService
  | DrawCountryRoomService
  | LiarsRoomService;

export function runMultiplayerEffect<A, E>(
  effect: Effect.Effect<A, E, MultiplayerServices>,
  signal?: AbortSignal,
) {
  return multiplayerRuntime.runPromise(effect, signal ? { signal } : undefined);
}

export function multiplayerTelemetrySnapshot() {
  return runMultiplayerEffect(MultiplayerTelemetry.use((telemetry) => telemetry.snapshot));
}

export function disposeMultiplayerRuntime() {
  // Clear the holder too, or the next call rebuilds against a runtime that has already been torn
  // down and every effect fails on a closed scope.
  delete runtimeHolder[RUNTIME_KEY];
  return multiplayerRuntime.dispose();
}
