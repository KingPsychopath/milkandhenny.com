import { beforeEach, describe, expect, it, vi } from "vitest";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/transfers/transfer-1/files/photo", {
    method: "DELETE",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("transfer file delete route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/features/auth/auth.server", () => ({
      requireAuth: vi
        .fn()
        .mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 })),
    }));
  });

  it("deletes one file and persists the updated transfer", async () => {
    const deleteObjects = vi.fn().mockResolvedValue(3);

    vi.doMock("@/features/transfers/store.server", () => ({
      getTransfer: vi.fn().mockResolvedValue({
        id: "transfer-1",
        title: "party",
        createdAt: "2026-03-08T10:00:00.000Z",
        expiresAt: "2999-03-09T10:00:00.000Z",
        deleteToken: "token",
        files: [
          {
            id: "photo",
            filename: "photo.jpg",
            kind: "image",
            size: 10,
            mimeType: "image/jpeg",
            storageKey: "transfers/transfer-1/original/photo.jpg",
            previewStatus: "ready",
            processingRoute: "local_image",
            groupId: "live_photo:motion:motion:primary:photo",
            groupRole: "primary",
          },
          {
            id: "motion",
            filename: "photo.mov",
            kind: "video",
            size: 20,
            mimeType: "video/quicktime",
            storageKey: "transfers/transfer-1/original/photo.mov",
            previewStatus: "ready",
            processingRoute: "local_video",
            groupId: "live_photo:motion:motion:primary:photo",
            groupRole: "motion",
          },
        ],
        groups: [
          {
            id: "live_photo:motion:motion:primary:photo",
            type: "live_photo",
            members: [
              { fileId: "photo", role: "primary", mimeType: "image/jpeg" },
              { fileId: "motion", role: "motion", mimeType: "video/quicktime" },
            ],
          },
        ],
      }),
      validateDeleteToken: vi.fn().mockResolvedValue(true),
      removeTransferFileAtomic: vi.fn().mockResolvedValue({
        status: "updated",
        transfer: {
          id: "transfer-1",
          title: "party",
          createdAt: "2026-03-08T10:00:00.000Z",
          expiresAt: "2999-03-09T10:00:00.000Z",
          deleteToken: "token",
          files: [
            {
              id: "motion",
              filename: "photo.mov",
              kind: "video",
              size: 20,
              storedBytes: 40,
              mimeType: "video/quicktime",
              storageKey: "transfers/transfer-1/original/photo.mov",
              previewStatus: "ready",
            },
          ],
        },
      }),
    }));
    vi.doMock("@/features/transfers/media-state", () => ({
      classifyTransferProcessingRoute: vi.fn().mockReturnValue("local_image"),
      getExpectedTransferAssetKeys: vi.fn().mockReturnValue({
        thumbKey: "transfers/transfer-1/thumb/photo.webp",
        fullKey: "transfers/transfer-1/full/photo.webp",
      }),
    }));
    vi.doMock("@/lib/platform/r2.server", () => ({
      deleteObjects,
      isTransferStorageConfigured: () => true,
    }));

    const { DELETE } = await import("@/src/routes/api/transfers/$id/files/$fileId/route");
    const response = await DELETE(makeRequest({ token: "token" }), {
      params: Promise.resolve({ id: "transfer-1", fileId: "photo" }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      transfer?: { groups?: unknown; files?: Array<Record<string, unknown>> };
    };
    expect(payload).toMatchObject({
      success: true,
      deletedTransfer: false,
      deletedFileId: "photo",
      transfer: {
        files: [expect.objectContaining({ id: "motion" })],
      },
    });
    expect(payload.transfer).not.toHaveProperty("groups");
    expect(payload.transfer?.files?.[0]).not.toHaveProperty("storageKey");
    expect(payload.transfer?.files?.[0]).not.toHaveProperty("storedBytes");
    expect(deleteObjects).toHaveBeenCalledWith(
      [
        "transfers/transfer-1/original/photo.jpg",
        "transfers/transfer-1/thumb/photo.webp",
        "transfers/transfer-1/full/photo.webp",
      ],
      { scope: "private" },
    );
  });

  it("takes down the transfer when the last file is removed", async () => {
    vi.doMock("@/features/transfers/store.server", () => ({
      getTransfer: vi.fn().mockResolvedValue({
        id: "transfer-1",
        title: "party",
        createdAt: "2026-03-08T10:00:00.000Z",
        expiresAt: "2999-03-09T10:00:00.000Z",
        deleteToken: "token",
        files: [
          {
            id: "photo",
            filename: "photo.jpg",
            kind: "image",
            size: 10,
            mimeType: "image/jpeg",
            storageKey: "transfers/transfer-1/original/photo.jpg",
          },
        ],
      }),
      validateDeleteToken: vi.fn().mockResolvedValue(true),
      removeTransferFileAtomic: vi.fn().mockResolvedValue({ status: "deleted" }),
    }));
    vi.doMock("@/features/transfers/media-state", () => ({
      classifyTransferProcessingRoute: vi.fn().mockReturnValue("local_image"),
      getExpectedTransferAssetKeys: vi.fn().mockReturnValue({}),
    }));
    vi.doMock("@/lib/platform/r2.server", () => ({
      deleteObjects: vi.fn().mockResolvedValue(1),
      isTransferStorageConfigured: () => true,
    }));

    const { DELETE } = await import("@/src/routes/api/transfers/$id/files/$fileId/route");
    const response = await DELETE(makeRequest({ token: "token" }), {
      params: Promise.resolve({ id: "transfer-1", fileId: "photo" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      deletedTransfer: true,
      dataDeleted: true,
      deletedFileId: "photo",
    });
  });

  it("lets an authenticated admin remove a file from either management surface", async () => {
    const requireAuth = vi.fn().mockResolvedValue(null);
    vi.doMock("@/features/auth/auth.server", () => ({ requireAuth }));
    vi.doMock("@/features/transfers/store.server", () => ({
      getTransfer: vi.fn().mockResolvedValue({
        id: "transfer-1",
        title: "party",
        createdAt: "2026-03-08T10:00:00.000Z",
        expiresAt: "2999-03-09T10:00:00.000Z",
        deleteToken: "token",
        files: [
          {
            id: "photo",
            filename: "photo.jpg",
            kind: "image",
            size: 10,
            mimeType: "image/jpeg",
            storageKey: "transfers/transfer-1/original/photo.jpg",
          },
        ],
      }),
      validateDeleteToken: vi.fn().mockResolvedValue(false),
      removeTransferFileAtomic: vi.fn().mockResolvedValue({ status: "deleted" }),
    }));
    vi.doMock("@/features/transfers/media-state", () => ({
      classifyTransferProcessingRoute: vi.fn().mockReturnValue("local_image"),
      getExpectedTransferAssetKeys: vi.fn().mockReturnValue({}),
    }));
    vi.doMock("@/lib/platform/r2.server", () => ({
      deleteObjects: vi.fn().mockResolvedValue(1),
      isTransferStorageConfigured: () => true,
    }));

    const { DELETE: deleteFromAdmin } =
      await import("@/src/routes/api/admin/transfers/$id/files/$fileId/route");
    const adminResponse = await deleteFromAdmin(makeRequest({}), "transfer-1", "photo");
    expect(adminResponse.status).toBe(200);
    await expect(adminResponse.json()).resolves.toMatchObject({
      success: true,
      deletedTransfer: true,
      deletedFileId: "photo",
    });

    const { DELETE: deleteFromTransfer } =
      await import("@/src/routes/api/transfers/$id/files/$fileId/route");
    const response = await deleteFromTransfer(makeRequest({}), {
      params: Promise.resolve({ id: "transfer-1", fileId: "photo" }),
    });

    expect(response.status).toBe(200);
    expect(requireAuth).toHaveBeenCalledTimes(2);
    expect(requireAuth).toHaveBeenCalledWith(expect.any(Request), "admin");
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      deletedTransfer: true,
      deletedFileId: "photo",
    });
  });
});
