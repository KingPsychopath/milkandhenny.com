import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/admin/transfers/process-media", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("admin transfer media route", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("retries the matching file by mediaId when filenames collide", async () => {
    const requeueTransferFile = vi.fn().mockResolvedValue({
      id: "photo-2",
      filename: "photo.jpg",
      kind: "image",
      size: 20,
      mimeType: "image/jpeg",
      storageKey: "transfers/transfer-1/derived/photo.jpg",
      previewStatus: "original_only",
      processingStatus: "queued",
      processingRoute: "worker_image",
      enqueuedAt: "2026-03-08T10:00:00.000Z",
      retryCount: 1,
    });
    const saveTransfer = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/features/auth/server", () => ({
      requireAuth: vi.fn().mockResolvedValue(null),
      requireAdminStepUp: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@/features/media/backends/worker", () => ({
      runTransferMediaJobs: vi.fn(),
      requeueTransferFile,
    }));
    vi.doMock("@/features/transfers/upload", () => ({
      backfillTransferMedia: vi.fn(),
    }));
    vi.doMock("@/features/transfers/store", () => ({
      getTransfer: vi.fn().mockResolvedValue({
        id: "transfer-1",
        title: "transfer",
        createdAt: "2026-03-08T09:00:00.000Z",
        expiresAt: "2026-03-09T11:00:00.000Z",
        deleteToken: "token",
        files: [
          {
            id: "photo",
            filename: "photo.jpg",
            kind: "image",
            size: 10,
            mimeType: "image/jpeg",
            storageKey: "transfers/transfer-1/derived/photo.jpg",
            processingStatus: "failed",
          },
          {
            id: "photo-2",
            filename: "photo.jpg",
            kind: "image",
            size: 20,
            mimeType: "image/jpeg",
            storageKey: "transfers/transfer-1/derived/photo.jpg",
            processingStatus: "failed",
          },
        ],
      }),
      saveTransfer,
    }));
    vi.doMock("@/lib/platform/api-error", () => ({
      apiErrorFromRequest: vi.fn(),
    }));

    const { POST } = await import("@/app/api/admin/transfers/process-media/route");
    const response = await POST(
      makeRequest({
        mode: "retry",
        transferId: "transfer-1",
        mediaId: "photo-2",
        filename: "photo.jpg",
        force: true,
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      requeued: true,
      mediaId: "photo-2",
      filename: "photo.jpg",
      processingStatus: "queued",
    });
    expect(requeueTransferFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: "transfer-1" }),
      expect.objectContaining({ id: "photo-2" }),
      true
    );
    expect(saveTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          expect.objectContaining({ id: "photo", processingStatus: "failed" }),
          expect.objectContaining({ id: "photo-2", processingStatus: "queued" }),
        ],
      }),
      expect.any(Number)
    );
  });

  it("reports retry no-ops as unsuccessful", async () => {
    const target = {
      id: "capture",
      filename: "capture.dng",
      kind: "image",
      size: 20,
      mimeType: "image/x-adobe-dng",
      storageKey: "transfers/transfer-1/originals/capture.dng",
      processingStatus: "failed",
      processingRoute: "worker_raw",
      retryCount: 3,
    };

    vi.doMock("@/features/auth/server", () => ({
      requireAuth: vi.fn().mockResolvedValue(null),
      requireAdminStepUp: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@/features/media/backends/worker", () => ({
      runTransferMediaJobs: vi.fn(),
      requeueTransferFile: vi.fn().mockResolvedValue(target),
    }));
    vi.doMock("@/features/transfers/upload", () => ({
      backfillTransferMedia: vi.fn(),
    }));
    vi.doMock("@/features/transfers/store", () => ({
      getTransfer: vi.fn().mockResolvedValue({
        id: "transfer-1",
        title: "transfer",
        createdAt: "2026-03-08T09:00:00.000Z",
        expiresAt: "2026-03-09T11:00:00.000Z",
        deleteToken: "token",
        files: [target],
      }),
      saveTransfer: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("@/lib/platform/api-error", () => ({
      apiErrorFromRequest: vi.fn(),
    }));

    const { POST } = await import("@/app/api/admin/transfers/process-media/route");
    const response = await POST(
      makeRequest({
        mode: "retry",
        transferId: "transfer-1",
        mediaId: "capture",
        force: true,
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      requeued: false,
      mediaId: "capture",
      processingStatus: "failed",
      retryCount: 3,
    });
  });
});
