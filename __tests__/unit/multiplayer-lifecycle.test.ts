import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { MultiplayerLifecycle } from "@/features/things/shared/multiplayer-lifecycle.server";

describe("multiplayer lifecycle", () => {
  it("cancels repeating work when its runtime scope closes", async () => {
    let ticks = 0;
    let resolveFirstTick!: () => void;
    const firstTick = new Promise<void>((resolve) => {
      resolveFirstTick = resolve;
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const lifecycle = yield* MultiplayerLifecycle;
          yield* lifecycle.registerRepeating("test-sweep", 5, () => {
            ticks += 1;
            resolveFirstTick();
          });
          yield* Effect.promise(() => firstTick);
        }).pipe(Effect.provide(MultiplayerLifecycle.layer)),
      ),
    );

    const ticksAtClose = ticks;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(ticksAtClose).toBeGreaterThan(0);
    expect(ticks).toBe(ticksAtClose);
  });

  it("registers a named repeating task only once", async () => {
    let ticks = 0;
    let resolveFirstTick!: () => void;
    const firstTick = new Promise<void>((resolve) => {
      resolveFirstTick = resolve;
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const lifecycle = yield* MultiplayerLifecycle;
          const task = () => {
            ticks += 1;
            resolveFirstTick();
          };
          yield* lifecycle.registerRepeating("one-task", 5, task);
          yield* lifecycle.registerRepeating("one-task", 5, task);
          yield* Effect.promise(() => firstTick);
        }).pipe(Effect.provide(MultiplayerLifecycle.layer)),
      ),
    );

    expect(ticks).toBe(1);
  });
});
