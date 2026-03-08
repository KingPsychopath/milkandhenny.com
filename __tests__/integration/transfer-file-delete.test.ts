import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/transfers/transfer-1/files/photo", {
    method: "DELETE",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("transfer file delete route", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("deletes one file and persists the updated transfer", async () => {
    const saveTransfer = vi.fn().mockResolvedValue(undefined);
    const deleteTransferData = vi.fn().mockResolvedValue(false);
    const deleteObjects = vi.fn().mockResolvedValue(3);

    vi.doMock("@/features/transfers/store", () => ({
      getTransfer: vi.fn().mockResolvedValue({
        id: "transfer-1",
        title: "party",
        createdAt: "2026-03-08T10:00:00.000Z",
        expiresAt: "2026-03-09T10:00:00.000Z",
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
      removeTransferFile: (transfer: { files: unknown[] }) => ({
        ...transfer,
        files: [
          {
            id: "motion",
            filename: "photo.mov",
            kind: "video",
            size: 20,
            mimeType: "video/quicktime",
            storageKey: "transfers/transfer-1/original/photo.mov",
            previewStatus: "ready",
          },
        ],
        groups: undefined,
      }),
      saveTransfer,
      deleteTransferData,
    }));
    vi.doMock("@/features/transfers/media-state", () => ({
      classifyTransferProcessingRoute: vi.fn().mockReturnValue("local_image"),
      getExpectedTransferAssetKeys: vi.fn().mockReturnValue({
        thumbKey: "transfers/transfer-1/thumb/photo.webp",
        fullKey: "transfers/transfer-1/full/photo.webp",
      }),
    }));
    vi.doMock("@/lib/platform/r2", () => ({
      deleteObjects,
      isConfigured: () => true,
    }));

    const { DELETE } = await import("@/app/api/transfers/[id]/files/[fileId]/route");
    const response = await DELETE(makeRequest({ token: "token" }), {
      params: Promise.resolve({ id: "transfer-1", fileId: "photo" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      success: true,
      deletedTransfer: false,
      deletedFileId: "photo",
      transfer: {
        files: [expect.objectContaining({ id: "motion" })],
      },
    });
    expect(payload.transfer).not.toHaveProperty("groups");
    expect(deleteObjects).toHaveBeenCalledWith([
      "transfers/transfer-1/original/photo.jpg",
      "transfers/transfer-1/thumb/photo.webp",
      "transfers/transfer-1/full/photo.webp",
    ]);
    expect(saveTransfer).toHaveBeenCalledOnce();
    expect(deleteTransferData).not.toHaveBeenCalled();
  });

  it("takes down the transfer when the last file is removed", async () => {
    const deleteTransferData = vi.fn().mockResolvedValue(true);

    vi.doMock("@/features/transfers/store", () => ({
      getTransfer: vi.fn().mockResolvedValue({
        id: "transfer-1",
        title: "party",
        createdAt: "2026-03-08T10:00:00.000Z",
        expiresAt: "2026-03-09T10:00:00.000Z",
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
      removeTransferFile: (transfer: { files: unknown[] }) => ({ ...transfer, files: [], groups: undefined }),
      saveTransfer: vi.fn(),
      deleteTransferData,
    }));
    vi.doMock("@/features/transfers/media-state", () => ({
      classifyTransferProcessingRoute: vi.fn().mockReturnValue("local_image"),
      getExpectedTransferAssetKeys: vi.fn().mockReturnValue({}),
    }));
    vi.doMock("@/lib/platform/r2", () => ({
      deleteObjects: vi.fn().mockResolvedValue(1),
      isConfigured: () => true,
    }));

    const { DELETE } = await import("@/app/api/transfers/[id]/files/[fileId]/route");
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
    expect(deleteTransferData).toHaveBeenCalledWith("transfer-1");
  });
});
