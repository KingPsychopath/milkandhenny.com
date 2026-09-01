import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";

import { BestDressedService } from "@/features/best-dressed/best-dressed-service.server";
import { RedisService } from "@/lib/platform/provider-services.server";

describe("best dressed Effect service", () => {
  it("runs the workflow against the Redis client supplied by its Layer", async () => {
    const values = new Map<string, unknown>();
    const client = {
      del: vi.fn(async (key: string) => (values.delete(key) ? 1 : 0)),
      expire: vi.fn(async () => 1),
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown) => {
        values.set(key, value);
        return "OK";
      }),
    };
    const redisLayer = Layer.succeed(RedisService, {
      client: Effect.succeed(client as never),
    });
    const layer = BestDressedService.layer.pipe(Layer.provide(redisLayer));

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* BestDressedService;
        const opened = yield* service.setVotingWindow(5);
        const readBack = yield* service.getVotingWindow;
        return { opened, readBack };
      }).pipe(Effect.provide(layer)),
    );

    expect(result.opened).toMatchObject({ ok: true, isOpen: true, minutes: 5 });
    expect(result.readBack).toMatchObject({ ok: true, isOpen: true });
    expect(result.readBack.openUntil).toBe(result.opened.openUntil);
    expect(client.set).toHaveBeenCalledOnce();
    expect(client.expire).toHaveBeenCalledOnce();
    expect(client.get).toHaveBeenCalledOnce();
  });
});
