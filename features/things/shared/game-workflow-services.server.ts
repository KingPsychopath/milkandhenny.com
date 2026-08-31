import { Context, Effect, Layer } from "effect";

import type { GameContext } from "./game-engine";

const DEFAULT_RANDOM_VALUE_COUNT = 32;

export function liveGameContext(randomValueCount = DEFAULT_RANDOM_VALUE_COUNT): GameContext {
  const values = new Uint32Array(Math.max(0, randomValueCount));
  crypto.getRandomValues(values);
  return {
    now: Date.now(),
    newId: crypto.randomUUID(),
    randomValues: Array.from(values, (value) => value / 0x1_0000_0000),
  };
}

export class GameClock extends Context.Service<
  GameClock,
  { readonly currentTimeMillis: Effect.Effect<number> }
>()("GameClock") {
  static readonly layer = Layer.succeed(this, {
    currentTimeMillis: Effect.sync(() => Date.now()),
  });
}

export class GameIdGenerator extends Context.Service<
  GameIdGenerator,
  { readonly next: Effect.Effect<string> }
>()("GameIdGenerator") {
  static readonly layer = Layer.succeed(this, {
    next: Effect.sync(() => crypto.randomUUID()),
  });
}

export class GameRandom extends Context.Service<
  GameRandom,
  { readonly values: (count: number) => Effect.Effect<readonly number[]> }
>()("GameRandom") {
  static readonly layer = Layer.succeed(this, {
    values: (count) =>
      Effect.sync(() => {
        const values = new Uint32Array(Math.max(0, count));
        crypto.getRandomValues(values);
        return Array.from(values, (value) => value / 0x1_0000_0000);
      }),
  });
}

export const gameWorkflowServicesLayer = Layer.mergeAll(
  GameClock.layer,
  GameIdGenerator.layer,
  GameRandom.layer,
);

export function gameWorkflowTestLayer(context: GameContext) {
  return Layer.mergeAll(
    Layer.succeed(GameClock, { currentTimeMillis: Effect.succeed(context.now) }),
    Layer.succeed(GameIdGenerator, { next: Effect.succeed(context.newId) }),
    Layer.succeed(GameRandom, {
      values: (count) =>
        Effect.sync(() => {
          const length = Math.max(0, count);
          if (length > 0 && context.randomValues.length === 0)
            throw new RangeError("Test game context has no random values");
          return Array.from(
            { length },
            (_unused, index) => context.randomValues[index % context.randomValues.length],
          );
        }),
    }),
  );
}

export function makeGameContext(randomValueCount = DEFAULT_RANDOM_VALUE_COUNT) {
  return Effect.gen(function* () {
    const clock = yield* GameClock;
    const ids = yield* GameIdGenerator;
    const random = yield* GameRandom;
    const [now, newId, randomValues] = yield* Effect.all([
      clock.currentTimeMillis,
      ids.next,
      random.values(randomValueCount),
    ]);
    return { now, newId, randomValues } satisfies GameContext;
  });
}
