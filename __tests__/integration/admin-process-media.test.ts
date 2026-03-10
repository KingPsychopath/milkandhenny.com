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

  it("reports drain mode without invoking the external worker", async () => {
    vi.doMock("@/features/auth/server", () => ({
      requireAuth: vi.fn().mockResolvedValue(null),
      requireAdminStepUp: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@/features/transfers/upload", () => ({
      backfillTransferMedia: vi.fn(),
    }));
    vi.doMock("@/features/transfers/store", () => ({
      getTransfer: vi.fn(),
    }));
    vi.doMock("@/features/transfers/admin", () => ({
      getAdminTransferMediaStats: vi.fn().mockResolvedValue({
        queueLength: 21,
        worker: { lastHeartbeatAt: "2026-03-08T22:29:30.000Z" },
      }),
    }));
    vi.doMock("@/lib/platform/api-error", () => ({
      apiErrorFromRequest: vi.fn(),
    }));

    const { POST } = await import("@/app/api/admin/transfers/process-media/route");
    const response = await POST(makeRequest({ mode: "drain", limit: 7 }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      mode: "drain",
      workerDisabled: true,
      processedJobs: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      queueLength: 21,
      worker: {
        lastHeartbeatAt: "2026-03-08T22:29:30.000Z",
      },
    });
  });

  it("retries the matching file by mediaId when filenames collide", async () => {
    const backfillTransferMedia = vi.fn().mockResolvedValue({
      id: "transfer-1",
      title: "transfer",
      createdAt: "2026-03-08T09:00:00.000Z",
      expiresAt: "2026-03-10T11:00:00.000Z",
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
          previewStatus: "ready",
          processingStatus: "local_done",
          processingRoute: "local_image",
          retryCount: 1,
        },
      ],
    });

    vi.doMock("@/features/auth/server", () => ({
      requireAuth: vi.fn().mockResolvedValue(null),
      requireAdminStepUp: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@/features/transfers/upload", () => ({
      backfillTransferMedia,
    }));
    vi.doMock("@/features/transfers/store", () => ({
      getTransfer: vi.fn().mockResolvedValue({
        id: "transfer-1",
        title: "transfer",
        createdAt: "2026-03-08T09:00:00.000Z",
        expiresAt: "2026-03-10T11:00:00.000Z",
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
      processingStatus: "local_done",
    });
    expect(backfillTransferMedia).toHaveBeenCalledWith(
      expect.objectContaining({ id: "transfer-1" })
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
    vi.doMock("@/features/transfers/upload", () => ({
      backfillTransferMedia: vi.fn().mockResolvedValue({
        id: "transfer-1",
        title: "transfer",
        createdAt: "2026-03-08T09:00:00.000Z",
        expiresAt: "2026-03-10T11:00:00.000Z",
        deleteToken: "token",
        files: [target],
      }),
    }));
    vi.doMock("@/features/transfers/store", () => ({
      getTransfer: vi.fn().mockResolvedValue({
        id: "transfer-1",
        title: "transfer",
        createdAt: "2026-03-08T09:00:00.000Z",
        expiresAt: "2026-03-10T11:00:00.000Z",
        deleteToken: "token",
        files: [target],
      }),
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
