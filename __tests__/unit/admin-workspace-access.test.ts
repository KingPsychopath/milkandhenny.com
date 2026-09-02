import { afterEach, describe, expect, it, vi } from "vitest";

function namedAdminSession() {
  const now = new Date().toISOString();
  return {
    personId: "person_named_admin",
    authenticatedAt: now,
    passkeyAuthenticatedAt: now,
    assurance: {
      primary: "passkey",
      factors: ["passkey"],
      phishingResistant: true,
      authenticatedAt: now,
    },
  };
}

describe("admin workspace access", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("admits a content-only named admin and exposes only their effective permissions", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.doMock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
    vi.doMock("@/features/attendee-access/session.server", () => ({
      getAttendeeSessionForRequest: async () => namedAdminSession(),
    }));
    vi.doMock("@/lib/platform/postgres.server", () => ({
      query: async () => [
        {
          person_id: "person_named_admin",
          role_preset: "content",
          overrides: {},
        },
      ],
    }));

    const { getAdminWorkspaceAccess } = await import("@/features/auth/auth.server");
    const access = await getAdminWorkspaceAccess(new Request("http://localhost/admin"));

    expect(access).toMatchObject({
      ok: true,
      kind: "named",
      permissions: {
        manageContent: true,
        viewOperations: false,
        manageGlobalSettings: false,
      },
    });
  });

  it("merges concurrent active grants and honours explicit overrides", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.doMock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
    vi.doMock("@/features/attendee-access/session.server", () => ({
      getAttendeeSessionForRequest: async () => namedAdminSession(),
    }));
    vi.doMock("@/lib/platform/postgres.server", () => ({
      query: async () => [
        {
          person_id: "person_named_admin",
          role_preset: "content",
          overrides: { manageContent: false, viewAudit: true },
        },
        {
          person_id: "person_named_admin",
          role_preset: "communications",
          overrides: {},
        },
      ],
    }));

    const { getAdminWorkspaceAccess } = await import("@/features/auth/auth.server");
    const access = await getAdminWorkspaceAccess(new Request("http://localhost/admin"));

    expect(access).toMatchObject({
      ok: true,
      kind: "named",
      permissions: {
        manageContent: false,
        manageCommunications: true,
        viewOperations: true,
        viewAudit: true,
        manageGlobalSettings: false,
      },
    });
  });
});
