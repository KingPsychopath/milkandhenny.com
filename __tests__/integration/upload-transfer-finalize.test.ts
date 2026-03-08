import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/upload/transfer/finalize", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("upload transfer finalize", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("queues visual media instead of processing it inline", async () => {
    const enqueueWorkerJob = vi.fn().mockResolvedValue({
      file: {
        id: "photo",
        filename: "photo.jpg",
        kind: "image",
        size: 123,
        mimeType: "image/jpeg",
        storageKey: "transfers/transfer-1/original/photo.jpg",
        previewStatus: "original_only",
        processingStatus: "queued",
        processingBackend: "worker",
        processingRoute: "worker_image",
      },
      uploadedBytes: 123,
    });
    const processUploadedFile = vi.fn();
    const saveTransfer = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/features/auth/server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({
        error: null,
        payload: { role: "upload" },
      }),
    }));
    vi.doMock("@/features/transfers/store", () => ({
      saveTransfer,
      MAX_EXPIRY_SECONDS: 30 * 24 * 60 * 60,
      MAX_TRANSFER_FILE_BYTES: 250 * 1024 * 1024,
      MAX_TRANSFER_TOTAL_BYTES: 1024 * 1024 * 1024,
    }));
    vi.doMock("@/features/transfers/upload", () => ({
      applyTransferAssetGroups: (files: unknown[]) => ({ files, groups: [] }),
      processUploadedFile,
      sortTransferFiles: (files: unknown[]) => files,
      isSafeTransferFilename: () => true,
    }));
    vi.doMock("@/features/transfers/media-state", () => ({
      buildTransferProcessingCounts: vi.fn().mockReturnValue({
        readyCount: 0,
        queuedCount: 1,
        failedCount: 0,
        skippedCount: 0,
        originalOnlyCount: 1,
      }),
      classifyTransferProcessingRoute: vi.fn().mockReturnValue("local_image"),
      resolveTransferUploadIds: (files: Array<{ name: string }>) =>
        files.map((file) => ({ ...file, mediaId: file.name.replace(/\.[^.]+$/, "") })),
    }));
    vi.doMock("@/features/media/backends/worker", () => ({
      enqueueWorkerJob,
    }));
    vi.doMock("@/lib/shared/config", () => ({
      BASE_URL: "https://example.com",
      hasPublicR2Url: () => true,
    }));
    vi.doMock("@/lib/platform/api-error", () => ({
      apiErrorFromRequest: vi.fn(),
    }));

    const { POST } = await import("@/app/api/upload/transfer/finalize/route");
    const response = await POST(
      makeRequest({
        transferId: "transfer-1",
        deleteToken: "delete-token",
        title: "party",
        expiresSeconds: 3600,
        files: [{ name: "photo.jpg", size: 123, type: "image/jpeg" }],
      })
    );

    expect(response.status).toBe(200);
    expect(enqueueWorkerJob).toHaveBeenCalledWith({
      transferId: "transfer-1",
      file: {
        mediaId: "photo",
        name: "photo.jpg",
        size: 123,
        type: "image/jpeg",
      },
      route: "local_image",
    });
    expect(processUploadedFile).not.toHaveBeenCalled();
    expect(saveTransfer).toHaveBeenCalledOnce();
  });
});
