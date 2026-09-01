import { Context, Effect, Layer } from "effect";

import { log } from "@/lib/platform/logger.server";
import { sweepMemoryRoomStores } from "./room-primitives.server";

const MEMORY_ROOM_SWEEP_INTERVAL_MS = 60_000;

/** Scoped process schedules shared by every server-authoritative multiplayer mode. */
export class MultiplayerLifecycle extends Context.Service<
  MultiplayerLifecycle,
  {
    readonly registerRepeating: (
      name: string,
      intervalMs: number,
      task: () => void,
    ) => Effect.Effect<void>;
  }
>()("MultiplayerLifecycle") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const registered = new Set<string>();
      const repeating = (name: string, intervalMs: number, task: () => void) =>
        Effect.sleep(intervalMs).pipe(
          Effect.andThen(Effect.sync(task)),
          Effect.catchCause((cause) =>
            Effect.sync(() =>
              log.warn("things.multiplayer", "Scoped lifecycle task failed", {
                cause: String(cause),
                name,
              }),
            ),
          ),
          Effect.forever,
        );
      const registerRepeating = (name: string, intervalMs: number, task: () => void) =>
        Effect.suspend(() => {
          if (registered.has(name)) return Effect.void;
          registered.add(name);
          return Effect.forkIn(repeating(name, intervalMs, task), scope).pipe(Effect.asVoid);
        });

      if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
        yield* Effect.sync(() => sweepMemoryRoomStores());
        yield* registerRepeating(
          "memory-room-sweeper",
          MEMORY_ROOM_SWEEP_INTERVAL_MS,
          sweepMemoryRoomStores,
        );
      }

      return { registerRepeating };
    }),
  );
}
