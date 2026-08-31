import { Context, Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => ({
  instances: [] as Array<{
    disconnect: ReturnType<typeof vi.fn>;
    publish: ReturnType<typeof vi.fn>;
    quit: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  }>,
  publishFails: false,
  subscribeFails: false,
}));

vi.mock("ioredis", () => ({
  default: class FakeRedis {
    disconnect = vi.fn();
    publish = vi.fn(() =>
      redis.publishFails ? Promise.reject(new Error("publish failed")) : Promise.resolve(1),
    );
    quit = vi.fn(() => Promise.resolve("OK"));
    subscribe = vi.fn(() =>
      redis.subscribeFails ? Promise.reject(new Error("subscribe failed")) : Promise.resolve(1),
    );

    constructor() {
      redis.instances.push(this);
    }

    on() {
      return this;
    }
  },
}));

vi.mock("@/lib/platform/redis-direct.server", () => ({
  getDirectRedisConfig: () => ({ source: "REDIS_URL", url: "redis://test" }),
}));
vi.mock("@/lib/platform/runtime-metadata.server", () => ({
  getRuntimeInstanceId: () => "test-instance",
}));
vi.mock("@/lib/platform/logger.server", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { MultiplayerRealtimeBackplane } from "@/features/things/shared/multiplayer-realtime-backplane.server";
import { MultiplayerTelemetry } from "@/features/things/shared/multiplayer-telemetry.server";

const backplaneLayer = MultiplayerRealtimeBackplane.layer.pipe(
  Layer.provide(MultiplayerTelemetry.layer),
);

function withBackplane<A>(
  use: (backplane: Context.Service.Shape<typeof MultiplayerRealtimeBackplane>) => Effect.Effect<A>,
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const backplane = yield* MultiplayerRealtimeBackplane;
        return yield* use(backplane);
      }).pipe(Effect.provide(backplaneLayer)),
    ),
  );
}

describe("multiplayer realtime backplane lifecycle", () => {
  beforeEach(() => {
    redis.instances.length = 0;
    redis.publishFails = false;
    redis.subscribeFails = false;
  });

  it("falls back to local delivery when the subscription is not ready", async () => {
    redis.subscribeFails = true;
    let deliveries = 0;

    const mode = await withBackplane((backplane) =>
      Effect.gen(function* () {
        const unsubscribe = yield* backplane.subscribe(() => {
          deliveries += 1;
        });
        yield* backplane.publish(
          "things:centre:v1:room:ABC2345:events",
          JSON.stringify({ type: "wake" }),
        );
        unsubscribe();
        return backplane.mode;
      }),
    );

    expect(mode).toBe("local");
    expect(deliveries).toBe(1);
    expect(redis.instances).toHaveLength(2);
    expect(redis.instances.every((client) => client.disconnect.mock.calls.length > 0)).toBe(true);
  });

  it("retries remote publication without replaying the local wake", async () => {
    redis.publishFails = true;
    let deliveries = 0;

    const mode = await withBackplane((backplane) =>
      Effect.gen(function* () {
        const unsubscribe = yield* backplane.subscribe(() => {
          deliveries += 1;
        });
        yield* backplane.publish(
          "things:centre:v1:room:ABC2345:events",
          JSON.stringify({ type: "wake" }),
        );
        unsubscribe();
        return backplane.mode;
      }),
    );

    expect(mode).toBe("redis");
    expect(deliveries).toBe(1);
    expect(redis.instances[0]?.publish).toHaveBeenCalledTimes(3);
    expect(redis.instances.every((client) => client.quit.mock.calls.length > 0)).toBe(true);
  });
});
