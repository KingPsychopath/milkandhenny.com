import { Effect, Layer } from "effect";
import {
  makeManagedRuntimeHost,
  type ManagedRuntimeHost,
} from "@/lib/platform/managed-runtime.server";

import { PairedGameRoomService } from "../remote/paired-game-room-service.server";
import { PartyRoomService } from "../spelling-party/party-room-service.server";
import { DrawCountryRoomService } from "../draw-country/draw-country-room-service.server";
import { LiarsRoomService } from "../liars/liars-room-service.server";
import { SameBrainRoomService } from "../same-brain/same-brain-room-service.server";
import { TwinRoomService } from "../twin/twin-room-service.server";
import { CentreRoomService } from "../centre/centre-room-service.server";
import { HotAndColdRoomService } from "../hot-and-cold/hot-and-cold-room-service.server";
import { FamilyFeudRoomService } from "../family-feud/family-feud-room-service.server";
import { MultiplayerTelemetry } from "./multiplayer-telemetry.server";
import { MultiplayerRealtimeBackplane } from "./multiplayer-realtime-backplane.server";
import { gameRealtimeChannel } from "./multiplayer-keys";
import { MULTIPLAYER_GAME_REGISTRY, type MultiplayerGame } from "./multiplayer-telemetry";
import { startMemoryRoomSweeper, stopMemoryRoomSweeper } from "./room-primitives.server";
import {
  GameClock,
  GameIdGenerator,
  GameRandom,
  gameWorkflowServicesLayer,
} from "./game-workflow-services.server";

const multiplayerLayer = Layer.mergeAll(
  MultiplayerTelemetry.layer,
  PairedGameRoomService.layer,
  PartyRoomService.layer.pipe(Layer.provide(MultiplayerTelemetry.layer)),
  DrawCountryRoomService.layer,
  LiarsRoomService.layer.pipe(Layer.provide(MultiplayerTelemetry.layer)),
  SameBrainRoomService.layer.pipe(Layer.provide(MultiplayerTelemetry.layer)),
  TwinRoomService.layer,
  CentreRoomService.layer,
  HotAndColdRoomService.layer,
  FamilyFeudRoomService.layer.pipe(Layer.provide(MultiplayerTelemetry.layer)),
  MultiplayerRealtimeBackplane.layer.pipe(Layer.provide(MultiplayerTelemetry.layer)),
  gameWorkflowServicesLayer,
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
  const outgoing = runtimeHolder[RUNTIME_KEY] as MultiplayerRuntimeHost | undefined;
  // Fire and forget: nothing is waiting on it, and a failed teardown of a runtime already being
  // thrown away is not worth taking the dev server down for.
  if (outgoing) void outgoing.dispose().catch(() => undefined);
  runtimeHolder[RUNTIME_KEY] = makeManagedRuntimeHost(multiplayerLayer, "Multiplayer");
} else {
  // Production evaluates once, so this is a plain module-scoped singleton with extra steps.
  runtimeHolder[RUNTIME_KEY] ??= makeManagedRuntimeHost(multiplayerLayer, "Multiplayer");
}

type MultiplayerServices =
  | MultiplayerTelemetry
  | MultiplayerRealtimeBackplane
  | PairedGameRoomService
  | PartyRoomService
  | DrawCountryRoomService
  | LiarsRoomService
  | SameBrainRoomService
  | TwinRoomService
  | CentreRoomService
  | HotAndColdRoomService
  | FamilyFeudRoomService
  | GameClock
  | GameIdGenerator
  | GameRandom;

type MultiplayerRuntimeHost = ManagedRuntimeHost<MultiplayerServices>;

function currentMultiplayerRuntime() {
  return runtimeHolder[RUNTIME_KEY] as MultiplayerRuntimeHost | undefined;
}

export function runMultiplayerEffect<A, E>(
  effect: Effect.Effect<A, E, MultiplayerServices>,
  signal?: AbortSignal,
): Promise<A> {
  // Older Vite module graphs can keep this function after hot replacement. Resolve through the
  // process holder on every call so they cannot send work to the runtime that replacement closed.
  const runtime = currentMultiplayerRuntime();
  if (!runtime) {
    // During shutdown the holder is already cleared while socket close events
    // and the idle sweep still fire; those callers expect a rejection they can
    // ignore, not a synchronous throw inside a timer callback.
    return Promise.reject(new Error("Multiplayer runtime is disposed"));
  }
  return runtime.run(effect, signal);
}

export function multiplayerTelemetrySnapshot() {
  return runMultiplayerEffect(MultiplayerTelemetry.use((telemetry) => telemetry.snapshot));
}

/** Publishes only a wake hint. Every client then reads its authorized snapshot over HTTPS. */
export function publishMultiplayerRoomWake(game: MultiplayerGame, roomId: string) {
  const version = Number(MULTIPLAYER_GAME_REGISTRY[game].channelVersion.slice(1));
  return runMultiplayerEffect(
    MultiplayerRealtimeBackplane.use((backplane) =>
      backplane.publish(
        gameRealtimeChannel(game, version, roomId),
        JSON.stringify({ type: "wake" }),
      ),
    ),
  );
}

export function publishMultiplayerRoomTermination(
  game: MultiplayerGame,
  roomId: string,
  input: {
    reason: "removed" | "room_closed" | "session_ended";
    playerId?: string;
    role?: string;
  },
) {
  const version = Number(MULTIPLAYER_GAME_REGISTRY[game].channelVersion.slice(1));
  return runMultiplayerEffect(
    MultiplayerRealtimeBackplane.use((backplane) =>
      backplane.publish(
        gameRealtimeChannel(game, version, roomId),
        JSON.stringify({ type: "terminal", ...input }),
      ),
    ),
  );
}

export function disposeMultiplayerRuntime() {
  // Clear the holder too, or the next call rebuilds against a runtime that has already been torn
  // down and every effect fails on a closed scope.
  const runtime = currentMultiplayerRuntime();
  delete runtimeHolder[RUNTIME_KEY];
  stopMemoryRoomSweeper();
  return runtime ? runtime.dispose() : Promise.resolve();
}

startMemoryRoomSweeper();
