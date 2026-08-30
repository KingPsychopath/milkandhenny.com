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

    const {
      getLocalDevAdminCookieValue,
      getAdminWorkspaceAccess,
      authenticateRequest,
      requireAuth,
      requireAdminStepUp,
    } = await import("@/features/auth/auth.server");
    const value = getLocalDevAdminCookieValue();

    expect(value).toEqual(expect.any(String));
    const request = requestWithCookie(`mah-auth-admin-dev=${value}`);
    expect((await authenticateRequest(request, "admin")).ok).toBe(true);
    expect(await requireAuth(request, "admin")).toBeNull();
    expect(await requireAdminStepUp(request)).toBeNull();
    const workspace = await getAdminWorkspaceAccess(request);
    expect(workspace).toMatchObject({
      ok: true,
      kind: "root",
      permissions: { manageGlobalSettings: true, manageContent: true },
    });
    expect("token" in workspace).toBe(false);
    expect("payload" in workspace).toBe(false);
  });

  it("keeps the development cookie stable across independently evaluated server graphs", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.doMock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));

    const firstModule = await import("@/features/auth/auth.server");
    const firstValue = firstModule.getLocalDevAdminCookieValue();
    vi.resetModules();
    const secondModule = await import("@/features/auth/auth.server");
    const secondValue = secondModule.getLocalDevAdminCookieValue();

    expect(firstValue).toEqual(expect.any(String));
    expect(secondValue).toBe(firstValue);
    expect(
      (
        await secondModule.authenticateRequest(
          requestWithCookie(`mah-auth-admin-dev=${firstValue}`),
          "admin",
        )
      ).ok,
    ).toBe(true);
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
