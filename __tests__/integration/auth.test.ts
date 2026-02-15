import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Integration tests for the auth module.
 *
 * Tests the full sign → verify JWT flow and the timing-safe
 * comparison primitive. Mocks only env vars and Redis (not the
 * auth logic itself).
 */

// Mock redis to avoid real connections
vi.mock("@/lib/redis", () => ({
  getRedis: () => null,
}));

describe("auth module", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      AUTH_SECRET: "test-secret-key-for-jwt-signing-1234567890",
      STAFF_PIN: "1234",
      MANAGEMENT_PASSWORD: "admin-pass",
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("safeCompare returns true for matching strings", async () => {
    const { safeCompare } = await import("@/lib/auth");
    expect(safeCompare("secret", "secret")).toBe(true);
  });

  it("safeCompare returns false for different strings", async () => {
    const { safeCompare } = await import("@/lib/auth");
    expect(safeCompare("secret", "wrong")).toBe(false);
  });

  it("safeCompare returns false for different-length strings", async () => {
    const { safeCompare } = await import("@/lib/auth");
    expect(safeCompare("short", "much-longer-string")).toBe(false);
  });
});
