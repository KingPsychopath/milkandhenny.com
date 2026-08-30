import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { memoryWindows } from "@/lib/platform/rate-limit.server";
import { rateLimitClaim } from "@/features/tickets/tickets.server";

vi.mock("@/lib/platform/redis.server", () => ({
  getRedis: () => null,
  getRedisRestConfig: () => null,
}));

describe("public ticket rate limiting", () => {
  beforeEach(() => {
    memoryWindows.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed in production when Redis is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(await rateLimitClaim("203.0.113.10")).toBe(false);
  });
});
