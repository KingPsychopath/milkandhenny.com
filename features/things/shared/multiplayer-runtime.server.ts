import { Effect, Layer, ManagedRuntime } from "effect";

import { PairedGameRoomService } from "../remote/paired-game-room-service.server";
import { PartyRoomService } from "../spelling-party/party-room-service.server";
import { DrawCountryRoomService } from "../draw-country/draw-country-room-service.server";
import { LiarsRoomService } from "../liars/liars-room-service.server";
import { SameBrainRoomService } from "../same-brain/same-brain-room-service.server";
import { MultiplayerTelemetry } from "./multiplayer-telemetry.server";
import { MultiplayerRealtimeBackplane } from "./multiplayer-realtime-backplane.server";

const multiplayerLayer = Layer.mergeAll(
  MultiplayerTelemetry.layer,
  PairedGameRoomService.layer,
  PartyRoomService.layer.pipe(Layer.provide(MultiplayerTelemetry.layer)),
  DrawCountryRoomService.layer,
  LiarsRoomService.layer.pipe(Layer.provide(MultiplayerTelemetry.layer)),
  SameBrainRoomService.layer.pipe(Layer.provide(MultiplayerTelemetry.layer)),
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
 */
const RUNTIME_KEY = "__milkandhenny_multiplayer_runtime__";

const runtimeHolder = globalThis as Record<string, unknown>;
runtimeHolder[RUNTIME_KEY] ??= ManagedRuntime.make(multiplayerLayer);
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
  | LiarsRoomService
  | SameBrainRoomService;

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
