import { beforeEach, describe, expect, it, vi } from "vitest";

describe("transfer account access", () => {
  beforeEach(() => vi.resetModules());

  it("uses a permitted signed-in account when legacy upload auth is absent", async () => {
    vi.doMock("@/features/auth/auth.server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({
        error: Response.json({ error: "Unauthorized" }, { status: 401 }),
        payload: null,
      }),
    }));
    vi.doMock("@/features/attendee-access/session.server", () => ({
      getAttendeeSession: vi.fn(),
      getAttendeeSessionForRequest: vi.fn().mockResolvedValue({
        id: "attendee-session",
        personId: "person-1",
      }),
    }));
    vi.doMock("@/features/attendee-access/account-permissions.server", () => ({
      personHasAccountPermission: vi.fn().mockResolvedValue(true),
    }));
    vi.doMock("@/features/transfers/store.server", () => ({ getTransfer: vi.fn() }));

    const { requireTransferUploadAccess } =
      await import("@/features/transfers/upload-access.server");
    await expect(
      requireTransferUploadAccess(
        new Request("https://milkandhenny.com/api/upload/transfer/presign"),
      ),
    ).resolves.toEqual({
      access: {
        actorJti: "account:attendee-session",
        isAdmin: false,
        ownerPersonId: "person-1",
      },
      error: null,
    });
  });

  it("does not let a signed-in account manage somebody else’s transfer", async () => {
    vi.doMock("@/features/auth/auth.server", () => ({ requireAuthWithPayload: vi.fn() }));
    vi.doMock("@/features/attendee-access/session.server", () => ({
      getAttendeeSession: vi.fn(),
      getAttendeeSessionForRequest: vi.fn().mockResolvedValue({
        id: "attendee-session",
        personId: "person-1",
      }),
    }));
    vi.doMock("@/features/attendee-access/account-permissions.server", () => ({
      personHasAccountPermission: vi.fn(),
    }));
    vi.doMock("@/features/transfers/store.server", () => ({
      getTransfer: vi.fn().mockResolvedValue({ ownerPersonId: "person-2" }),
    }));

    const { requestOwnsTransfer } = await import("@/features/transfers/upload-access.server");
    await expect(
      requestOwnsTransfer(new Request("https://milkandhenny.com/t/transfer-1"), "transfer-1"),
    ).resolves.toBe(false);
  });
});
