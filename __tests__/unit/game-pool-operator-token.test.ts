import { afterEach, describe, expect, it, vi } from "vitest";

import { buildGamePoolOperatorToken } from "@/features/things/pool/store.server";

describe("game-pool operator credentials", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed in production when the signing secret is unavailable", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "");

    expect(() => buildGamePoolOperatorToken("gpe_event", "open-once")).toThrow(
      /AUTH_SECRET must contain at least 32 characters/i,
    );
  });

  it("fails closed in production when the signing secret is too short", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "short-production-secret");

    expect(() => buildGamePoolOperatorToken("gpe_event", "open-once")).toThrow(
      /AUTH_SECRET must contain at least 32 characters/i,
    );
  });

  it("returns the same recoverable token for an idempotent open action", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AUTH_SECRET", "test-secret-value-long-enough-for-policy");

    const first = buildGamePoolOperatorToken("gpe_event", "open-once");
    const repeated = buildGamePoolOperatorToken("gpe_event", "open-once");
    expect(first).toBe(repeated);
    expect(first).toMatch(/^operate_[A-Za-z0-9_-]{30,}$/);
  });
});
