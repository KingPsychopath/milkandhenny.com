import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Auth integration tests.
 *
 * Notes:
 * - We use a lightweight request mock and cast it to `NextRequest` because the
 *   auth helpers only read `headers`, `url`, and `json()`.
 * - Redis is mocked in-memory so we can exercise revoke behavior deterministically.
 */

type RedisLike = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  del: (key: string) => Promise<void>;
  incr: (key: string) => Promise<number>;
  exists: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<void>;
  sadd: (key: string, value: string) => Promise<void>;
  srem: (key: string, value: string) => Promise<void>;
  smembers: (key: string) => Promise<string[]>;
  pipeline: () => {
    del: (key: string) => void;
    exists: (key: string) => void;
    srem: (key: string, value: string) => void;
    exec: () => Promise<number[]>;
  };
};

function createRedisMock(): RedisLike {
  const kv = new Map<string, unknown>();
  const sets = new Map<string, Set<string>>();

  const api: RedisLike = {
    async get(key) {
      return kv.get(key) ?? null;
    },
    async set(key, value) {
      kv.set(key, value);
    },
    async del(key) {
      kv.delete(key);
      sets.delete(key);
    },
    async incr(key) {
      const current = (kv.get(key) as number | undefined) ?? 0;
      const next = current + 1;
      kv.set(key, next);
      return next;
    },
    async exists(key) {
      return kv.has(key) || sets.has(key) ? 1 : 0;
    },
    async expire() {
      // TTL behavior isn't needed for these tests.
    },
    async sadd(key, value) {
      const s = sets.get(key) ?? new Set<string>();
      s.add(value);
      sets.set(key, s);
    },
    async srem(key, value) {
      const s = sets.get(key);
      if (!s) return;
      s.delete(value);
    },
    async smembers(key) {
      return [...(sets.get(key) ?? new Set<string>())];
    },
    pipeline() {
      const ops: Array<() => Promise<number>> = [];
      return {
        del(key: string) {
          ops.push(async () => {
            await api.del(key);
            return 1;
          });
        },
        exists(key: string) {
          ops.push(async () => api.exists(key));
        },
        srem(key: string, value: string) {
          ops.push(async () => {
            await api.srem(key, value);
            return 1;
          });
        },
        async exec() {
          const results: number[] = [];
          for (const op of ops) results.push(await op());
          return results;
        },
      };
    },
  };

  return api;
}

function mockRequest(opts: {
  headers?: Record<string, string>;
  jsonBody?: unknown;
}) {
  const headers = new Headers(opts.headers ?? {});
  return {
    headers,
    url: "http://localhost/api/test",
    async json() {
      return opts.jsonBody;
    },
  };
}

describe("auth security flows", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "test",
      AUTH_SECRET:
        "test-secret-key-for-jwt-signing-1234567890-EXTRA-LENGTH",
      STAFF_PIN: "1234",
      ADMIN_PASSWORD: "a-very-strong-admin-password",
      UPLOAD_PIN: "9999",
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.unstubAllGlobals();
  });

  it("safeCompare behaves correctly", async () => {
    vi.doMock("@/lib/redis", () => ({ getRedis: () => null }));
    const { safeCompare } = await import("@/lib/auth");
    expect(safeCompare("secret", "secret")).toBe(true);
    expect(safeCompare("secret", "wrong")).toBe(false);
    expect(safeCompare("short", "much-longer-string")).toBe(false);
  });

  it("issues role-based TTL tokens (admin shorter than staff)", async () => {
    vi.doMock("@/lib/redis", () => ({ getRedis: () => null }));
    const { handleVerifyRequest } = await import("@/lib/auth");

    const adminRes = await handleVerifyRequest(
      mockRequest({ jsonBody: { password: process.env.ADMIN_PASSWORD } }) as unknown as NextRequest,
      "admin"
    );
    const staffRes = await handleVerifyRequest(
      mockRequest({ jsonBody: { pin: process.env.STAFF_PIN } }) as unknown as NextRequest,
      "staff"
    );

    const adminJson = (await adminRes.json()) as { token: string };
    const staffJson = (await staffRes.json()) as { token: string };

    const decodePayload = (token: string) => {
      const payloadB64 = token.split(".")[1];
      const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((payloadB64.length + 3) % 4);
      return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as {
        role: string;
        iat: number;
        exp: number;
      };
    };

    const adminPayload = decodePayload(adminJson.token);
    const staffPayload = decodePayload(staffJson.token);

    expect(adminPayload.role).toBe("admin");
    expect(staffPayload.role).toBe("staff");

    const adminTtl = adminPayload.exp - adminPayload.iat;
    const staffTtl = staffPayload.exp - staffPayload.iat;
    expect(adminTtl).toBeLessThan(staffTtl);
  });

  it("revoking a specific jti makes that token unauthorized", async () => {
    const redis = createRedisMock();
    vi.doMock("@/lib/redis", () => ({ getRedis: () => redis }));
    const { handleVerifyRequest, requireAuth } = await import("@/lib/auth");

    const verifyRes = await handleVerifyRequest(
      mockRequest({ jsonBody: { password: process.env.ADMIN_PASSWORD } }) as unknown as NextRequest,
      "admin"
    );
    const { token } = (await verifyRes.json()) as { token: string };
    expect(typeof token).toBe("string");

    const payloadB64 = token.split(".")[1];
    const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((payloadB64.length + 3) % 4);
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as {
      jti: string;
      exp: number;
    };

    // Revoke by jti (what the API route does)
    await redis.set(`auth:revoked-jti:${payload.jti}`, 1);

    const err = await requireAuth(
      mockRequest({ headers: { authorization: `Bearer ${token}` } }) as unknown as NextRequest,
      "admin"
    );
    expect(err).not.toBeNull();
    expect(err?.status).toBe(401);
  });

  it("step-up gate blocks destructive actions without x-admin-step-up", async () => {
    const redis = createRedisMock();
    vi.doMock("@/lib/redis", () => ({ getRedis: () => redis }));
    const { handleVerifyRequest, requireAdminStepUp } = await import("@/lib/auth");

    const verifyRes = await handleVerifyRequest(
      mockRequest({ jsonBody: { password: process.env.ADMIN_PASSWORD } }) as unknown as NextRequest,
      "admin"
    );
    const { token } = (await verifyRes.json()) as { token: string };

    const missing = await requireAdminStepUp(
      mockRequest({ headers: { authorization: `Bearer ${token}` } }) as unknown as NextRequest
    );
    expect(missing).not.toBeNull();
    expect(missing?.status).toBe(428);
  });

  it("step-up token is bound to the admin session (jti)", async () => {
    const redis = createRedisMock();
    vi.doMock("@/lib/redis", () => ({ getRedis: () => redis }));
    const { handleVerifyRequest, createAdminStepUpToken, requireAdminStepUp } =
      await import("@/lib/auth");

    // Admin token A
    const verifyA = await handleVerifyRequest(
      mockRequest({ jsonBody: { password: process.env.ADMIN_PASSWORD } }) as unknown as NextRequest,
      "admin"
    );
    const { token: tokenA } = (await verifyA.json()) as { token: string };

    // Admin token B
    const verifyB = await handleVerifyRequest(
      mockRequest({ jsonBody: { password: process.env.ADMIN_PASSWORD } }) as unknown as NextRequest,
      "admin"
    );
    const { token: tokenB } = (await verifyB.json()) as { token: string };

    // Step-up token minted for session A
    const stepRes = await createAdminStepUpToken(
      mockRequest({
        headers: { authorization: `Bearer ${tokenA}` },
      }) as unknown as NextRequest,
      process.env.ADMIN_PASSWORD ?? ""
    );
    const stepJson = (await stepRes.json()) as { token?: string };
    expect(typeof stepJson.token).toBe("string");

    // Using tokenA's step-up while authed as tokenB must fail.
    const mismatch = await requireAdminStepUp(
      mockRequest({
        headers: {
          authorization: `Bearer ${tokenB}`,
          "x-admin-step-up": stepJson.token as string,
        },
      }) as unknown as NextRequest
    );
    expect(mismatch).not.toBeNull();
    expect(mismatch?.status).toBe(401);
  });

  it("token-version bump invalidates previously issued tokens", async () => {
    const redis = createRedisMock();
    vi.doMock("@/lib/redis", () => ({ getRedis: () => redis }));
    const { handleVerifyRequest, requireAuth, revokeRoleTokens } = await import(
      "@/lib/auth"
    );

    const verify = await handleVerifyRequest(
      mockRequest({ jsonBody: { password: process.env.ADMIN_PASSWORD } }) as unknown as NextRequest,
      "admin"
    );
    const { token } = (await verify.json()) as { token: string };

    // Revoke admin role sessions by bumping token version.
    await revokeRoleTokens("admin");

    const err = await requireAuth(
      mockRequest({ headers: { authorization: `Bearer ${token}` } }) as unknown as NextRequest,
      "admin"
    );
    expect(err).not.toBeNull();
    expect(err?.status).toBe(401);
  });
});
