import { afterEach, describe, expect, it, vi } from "vitest";

function requestWithCookie(cookie: string): Request {
  return new Request("http://localhost/admin", {
    headers: { cookie },
  });
}

describe("local admin auth bypass", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("authorizes the process-scoped development cookie across admin guards", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.doMock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));

    const { getLocalDevAdminCookieValue, authenticateRequest, requireAuth, requireAdminStepUp } =
      await import("@/features/auth/auth.server");
    const value = getLocalDevAdminCookieValue();

    expect(value).toEqual(expect.any(String));
    const request = requestWithCookie(`mah-auth-admin-dev=${value}`);
    expect((await authenticateRequest(request, "admin")).ok).toBe(true);
    expect(await requireAuth(request, "admin")).toBeNull();
    expect(await requireAdminStepUp(request)).toBeNull();
  });

  it("does not create or accept the bypass in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.doMock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));

    const { getLocalDevAdminCookieValue, authenticateRequest, requireAuth } =
      await import("@/features/auth/auth.server");

    expect(getLocalDevAdminCookieValue()).toBeNull();
    const request = requestWithCookie("mah-auth-admin-dev=not-a-real-session");
    expect((await authenticateRequest(request, "admin")).ok).toBe(false);
    expect((await requireAuth(request, "admin"))?.status).toBe(401);
  });
});
