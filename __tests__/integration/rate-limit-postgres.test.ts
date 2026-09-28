import { afterAll, beforeAll, expect, it, vi } from "vitest";

import {
  cleanupRateLimitWindows,
  clearRateLimit,
  reserveRateLimit,
} from "@/lib/platform/rate-limit.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("Postgres fixed-window rate limits", () => {
  beforeAll(async () => {
    vi.stubEnv("RATE_LIMIT_STORE", "postgres");
    vi.stubEnv("AUTH_SECRET", "integration-test-rate-secret-at-least-32-characters");
    await applySchema();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });

  it("counts attempts and keeps raw identities out of rows", async () => {
    const input = {
      name: "postgres-identity",
      identity: "192.0.2.10",
      limit: 2,
      windowSeconds: 60,
    };
    expect((await reserveRateLimit(input)).allowed).toBe(true);
    expect((await reserveRateLimit(input)).remaining).toBe(0);
    const denied = await reserveRateLimit(input);
    expect(denied).toMatchObject({ allowed: false, backendAvailable: true, remaining: 0 });
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect((await reserveRateLimit({ ...input, identity: "192.0.2.11" })).allowed).toBe(true);
    const rows = await query<{ subject_hash: string }>(
      "select subject_hash from rate_limit_windows where policy = $1",
      [input.name],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => /^[a-f0-9]{64}$/.test(row.subject_hash))).toBe(true);
  });

  it("serializes a shared global cap across concurrent identities", async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        reserveRateLimit({
          name: "postgres-global",
          identity: `network-${index}`,
          limit: 10,
          globalLimit: 2,
          windowSeconds: 60,
        }),
      ),
    );
    expect(outcomes.filter((item) => item.allowed)).toHaveLength(2);
    expect(outcomes.every((item) => item.backendAvailable)).toBe(true);
  });

  it("keeps the global cap when one identity is cleared and resets at expiry", async () => {
    const input = { name: "postgres-global-reset", limit: 2, globalLimit: 1, windowSeconds: 60 };
    expect((await reserveRateLimit({ ...input, identity: "a" })).allowed).toBe(true);
    await clearRateLimit(input.name, "a");
    expect((await reserveRateLimit({ ...input, identity: "b" })).allowed).toBe(false);
    await query(
      "update rate_limit_windows set expires_at = clock_timestamp() - interval '1 second' where policy = $1 and scope = 'global'",
      [input.name],
    );
    expect((await reserveRateLimit({ ...input, identity: "c" })).allowed).toBe(true);
  });

  it("starts a new window after expiry and clears an identity on success", async () => {
    const input = { name: "postgres-reset", identity: "person", limit: 1, windowSeconds: 60 };
    expect((await reserveRateLimit(input)).allowed).toBe(true);
    expect((await reserveRateLimit(input)).allowed).toBe(false);
    await query(
      "update rate_limit_windows set expires_at = clock_timestamp() - interval '1 second' where policy = $1",
      [input.name],
    );
    expect((await reserveRateLimit(input)).allowed).toBe(true);
    await clearRateLimit(input.name, input.identity);
    expect((await reserveRateLimit(input)).allowed).toBe(true);
  });

  it("fails closed when the subject hash secret is unavailable", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    try {
      const decision = await reserveRateLimit({
        name: "postgres-no-secret",
        identity: "person",
        limit: 1,
        windowSeconds: 60,
      });
      expect(decision).toMatchObject({ allowed: false, backendAvailable: false });
    } finally {
      vi.stubEnv("AUTH_SECRET", "integration-test-rate-secret-at-least-32-characters");
    }
  });

  it("removes expired rows in bounded batches", async () => {
    for (let index = 0; index < 3; index += 1) {
      await reserveRateLimit({
        name: "postgres-cleanup",
        identity: `person-${index}`,
        limit: 1,
        windowSeconds: 60,
      });
    }
    await query(
      "update rate_limit_windows set expires_at = clock_timestamp() - interval '1 second' where policy = 'postgres-cleanup'",
    );
    const result = await cleanupRateLimitWindows(2, 2);
    expect(result.removed).toBeGreaterThanOrEqual(3);
    expect(result.batches).toBe(2);
  });
});
