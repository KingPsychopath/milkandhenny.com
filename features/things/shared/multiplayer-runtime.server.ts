import { Effect, Layer, ManagedRuntime } from "effect";

import { PairedGameRoomService } from "../remote/paired-game-room-service.server";
import { PartyRoomService } from "../spelling-party/party-room-service.server";
import { DrawCountryRoomService } from "../draw-country/draw-country-room-service.server";
import { MultiplayerTelemetry } from "./multiplayer-telemetry.server";
import { MultiplayerRealtimeBackplane } from "./multiplayer-realtime-backplane.server";

const multiplayerLayer = Layer.mergeAll(
  MultiplayerTelemetry.layer,
  PairedGameRoomService.layer,
  PartyRoomService.layer.pipe(Layer.provide(MultiplayerTelemetry.layer)),
  DrawCountryRoomService.layer,
  MultiplayerRealtimeBackplane.layer.pipe(Layer.provide(MultiplayerTelemetry.layer)),
);

const multiplayerRuntime = ManagedRuntime.make(multiplayerLayer);

type MultiplayerServices =
  | MultiplayerTelemetry
  | MultiplayerRealtimeBackplane
  | PairedGameRoomService
  | PartyRoomService
  | DrawCountryRoomService;

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
  return multiplayerRuntime.dispose();
}
