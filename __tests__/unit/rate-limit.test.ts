import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearRateLimit, memoryWindows, reserveRateLimit } from "@/lib/platform/rate-limit.server";

/**
 * Exercises the in-memory fallback (no Redis in unit tests) and the
 * production fail-closed posture. The Redis path shares the same window
 * arithmetic via the Lua script; integration suites cover it indirectly
 * through the auth verify endpoints.
 */

const BASE = { name: "test-limit", limit: 3, windowSeconds: 60 } as const;

describe("shared rate limiter (memory fallback)", () => {
  beforeEach(() => {
    memoryWindows.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to the limit, then denies within the window", async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const decision = await reserveRateLimit({ ...BASE, identity: "a" });
      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(3 - attempt);
    }
    const denied = await reserveRateLimit({ ...BASE, identity: "a" });
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks identities independently", async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await reserveRateLimit({ ...BASE, identity: "a" });
    }
    const other = await reserveRateLimit({ ...BASE, identity: "b" });
    expect(other.allowed).toBe(true);
  });

  it("resets after the window expires", async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await reserveRateLimit({ ...BASE, identity: "a" });
    }
    vi.advanceTimersByTime(61_000);
    const decision = await reserveRateLimit({ ...BASE, identity: "a" });
    expect(decision.allowed).toBe(true);
  });

  it("forgives an identity when cleared", async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await reserveRateLimit({ ...BASE, identity: "a" });
    }
    await clearRateLimit(BASE.name, "a");
    const decision = await reserveRateLimit({ ...BASE, identity: "a" });
    expect(decision.allowed).toBe(true);
  });

  it("applies the global cap across identities", async () => {
    const options = { ...BASE, limit: 10, globalLimit: 2 };
    expect((await reserveRateLimit({ ...options, identity: "a" })).allowed).toBe(true);
    expect((await reserveRateLimit({ ...options, identity: "b" })).allowed).toBe(true);
    expect((await reserveRateLimit({ ...options, identity: "c" })).allowed).toBe(false);
  });

  it("fails closed in production when no backend is available", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const decision = await reserveRateLimit({ ...BASE, identity: "a" });
      expect(decision.allowed).toBe(false);
      expect(decision.backendAvailable).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
