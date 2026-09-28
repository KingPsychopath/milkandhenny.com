import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ options: [] as unknown[] }));

vi.mock("ioredis", () => ({
  default: class {
    constructor(_url: string, options: unknown) {
      state.options.push(options);
    }

    disconnect() {}
  },
}));

afterEach(() => {
  state.options.length = 0;
  vi.unstubAllEnvs();
});

describe("direct Redis clients", () => {
  it("leaves blocking queue claims without a command deadline", async () => {
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    const { createBlockingRedisClient, createDirectRedisClient } =
      await import("@/lib/platform/redis-direct.server");

    createDirectRedisClient();
    createBlockingRedisClient();

    expect(state.options[0]).toHaveProperty("commandTimeout", 15_000);
    expect(state.options[1]).not.toHaveProperty("commandTimeout");
  });
});
