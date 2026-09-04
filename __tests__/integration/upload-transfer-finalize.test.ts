import { beforeEach, describe, expect, it, vi } from "vitest";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/upload/transfer/finalize", {
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
    const processUploadedFile = vi.fn().mockResolvedValue({
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
    const createTransfer = vi.fn().mockResolvedValue(true);

    vi.doMock("@/features/auth/auth.server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({
        error: null,
        payload: { role: "upload", jti: "upload-session" },
      }),
    }));
    vi.doMock("@/features/transfers/upload-access.server", () => ({
      requireTransferUploadAccess: vi.fn().mockResolvedValue({
        error: null,
        access: {
          actorJti: "account:upload-session",
          isAdmin: false,
          ownerPersonId: "01990a1f-3b7c-7000-8000-000000000101",
        },
      }),
    }));
    vi.doMock("@/features/transfers/store.server", () => ({
      createTransfer,
      MAX_EXPIRY_SECONDS: 30 * 24 * 60 * 60,
      MAX_TRANSFER_FILES: 500,
      MAX_TRANSFER_FILE_BYTES: 250 * 1024 * 1024,
      MAX_TRANSFER_TOTAL_BYTES: 1024 * 1024 * 1024,
      normaliseTransferTitle: (value: unknown) =>
        typeof value === "string" && value.trim() ? value.trim() : "untitled",
    }));
    vi.doMock("@/features/transfers/upload-reservation.server", () => ({
      deleteTransferUploadReservation: vi.fn().mockResolvedValue(undefined),
      getTransferUploadReservation: vi.fn().mockResolvedValue({
        transferId: "transfer-1",
        deleteToken: "delete-token",
        actorJti: "account:upload-session",
        expiresSeconds: 3600,
        filesFingerprint: "fingerprint",
      }),
      transferUploadFilesFingerprint: vi.fn().mockReturnValue("fingerprint"),
    }));
    vi.doMock("@/lib/platform/r2.server", () => ({
      headObject: vi.fn().mockResolvedValue({ exists: true, size: 123 }),
    }));
    vi.doMock("@/features/transfers/upload.server", () => ({
      applyTransferAssetGroups: (files: unknown[]) => ({ files, groups: [] }),
      processUploadedFile,
      sortTransferFiles: (files: unknown[]) => files,
      isSafeTransferFilename: () => true,
    }));
    vi.doMock("@/features/transfers/media-state", () => ({
      HEIF_TRANSFER_UPLOAD_ERROR:
        "HEIC/HIF transfer uploads must be converted in the browser before upload.",
      buildTransferProcessingCounts: vi.fn().mockReturnValue({
        readyCount: 0,
        queuedCount: 1,
        failedCount: 0,
        skippedCount: 0,
        originalOnlyCount: 1,
      }),
      classifyTransferProcessingRoute: vi.fn().mockReturnValue("local_image"),
      isHeifUploadLike: vi.fn().mockReturnValue(false),
      resolveTransferUploadIds: (files: Array<{ name: string }>) =>
        files.map((file) => ({ ...file, mediaId: file.name.replace(/\.[^.]+$/, "") })),
    }));
    vi.doMock("@/lib/shared/config", () => ({
      getBaseUrlForRequest: (req: { url: string }) => new URL(req.url).origin,
      hasMediaPublicUrl: () => true,
    }));
    vi.doMock("@/lib/platform/api-error", () => ({
      apiErrorFromRequest: vi.fn(),
    }));

    const { POST } = await import("@/src/routes/api/upload/transfer/finalize/route");
    const response = await POST(
      makeRequest({
        transferId: "transfer-1",
        deleteToken: "delete-token",
        title: "party",
        expiresSeconds: 3600,
        files: [{ name: "photo.jpg", size: 123, type: "image/jpeg" }],
      }),
    );

    expect(response.status).toBe(200);
    expect(processUploadedFile).toHaveBeenCalledWith(
      {
        mediaId: "photo",
        name: "photo.jpg",
        size: 123,
        type: "image/jpeg",
      },
      "transfer-1",
    );
    expect(createTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ ownerPersonId: "01990a1f-3b7c-7000-8000-000000000101" }),
      3600,
    );
  });

  it("rejects raw heif uploads before processing", async () => {
    const processUploadedFile = vi.fn();

    vi.doMock("@/features/auth/auth.server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({
        error: null,
        payload: { role: "upload", jti: "upload-session" },
      }),
    }));
    vi.doMock("@/features/transfers/store.server", () => ({
      createTransfer: vi.fn(),
      MAX_EXPIRY_SECONDS: 30 * 24 * 60 * 60,
      MAX_TRANSFER_FILES: 500,
      MAX_TRANSFER_FILE_BYTES: 250 * 1024 * 1024,
      MAX_TRANSFER_TOTAL_BYTES: 1024 * 1024 * 1024,
      normaliseTransferTitle: (value: unknown) =>
        typeof value === "string" && value.trim() ? value.trim() : "untitled",
    }));
    vi.doMock("@/features/transfers/upload.server", () => ({
      applyTransferAssetGroups: (files: unknown[]) => ({ files, groups: [] }),
      processUploadedFile,
      sortTransferFiles: (files: unknown[]) => files,
      isSafeTransferFilename: () => true,
    }));
    vi.doMock("@/features/transfers/media-state", () => ({
      HEIF_TRANSFER_UPLOAD_ERROR:
        "HEIC/HIF transfer uploads must be converted in the browser before upload.",
      buildTransferProcessingCounts: vi.fn(),
      isHeifUploadLike: vi.fn().mockReturnValue(true),
      resolveTransferUploadIds: (files: Array<{ name: string }>) =>
        files.map((file) => ({ ...file, mediaId: file.name.replace(/\.[^.]+$/, "") })),
    }));
    vi.doMock("@/lib/shared/config", () => ({
      getBaseUrlForRequest: (req: { url: string }) => new URL(req.url).origin,
      hasMediaPublicUrl: () => true,
    }));
    vi.doMock("@/lib/platform/api-error", () => ({
      apiErrorFromRequest: vi.fn(),
    }));

    const { POST } = await import("@/src/routes/api/upload/transfer/finalize/route");
    const response = await POST(
      makeRequest({
        transferId: "transfer-1",
        deleteToken: "delete-token",
        title: "party",
        expiresSeconds: 3600,
        files: [{ name: "capture.hif", size: 123, type: "image/heif" }],
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "HEIC/HIF transfer uploads must be converted in the browser before upload.",
    });
    expect(processUploadedFile).not.toHaveBeenCalled();
  });

  it("returns an already completed transfer when finalization is retried", async () => {
    const createTransfer = vi.fn();
    const processUploadedFile = vi.fn();

    vi.doMock("@/features/auth/auth.server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({
        error: null,
        payload: { role: "upload", jti: "upload-session" },
      }),
    }));
    vi.doMock("@/features/transfers/store.server", () => ({
      createTransfer,
      getTransfer: vi.fn().mockResolvedValue({
        id: "transfer-1",
        title: "party",
        createdAt: "2026-08-31T12:00:00.000Z",
        expiresAt: "2026-09-01T12:00:00.000Z",
        deleteToken: "delete-token",
        files: [
          {
            id: "photo",
            filename: "photo.jpg",
            kind: "image",
            size: 123,
            mimeType: "image/jpeg",
            storageKey: "transfers/transfer-1/original/photo.jpg",
          },
        ],
      }),
      validateDeleteToken: vi.fn().mockResolvedValue(true),
      MAX_EXPIRY_SECONDS: 30 * 24 * 60 * 60,
      MAX_TRANSFER_FILES: 500,
      MAX_TRANSFER_FILE_BYTES: 250 * 1024 * 1024,
      MAX_TRANSFER_TOTAL_BYTES: 1024 * 1024 * 1024,
      normaliseTransferTitle: (value: unknown) =>
        typeof value === "string" && value.trim() ? value.trim() : "untitled",
    }));
    vi.doMock("@/features/transfers/upload-reservation.server", () => ({
      deleteTransferUploadReservation: vi.fn(),
      getTransferUploadReservation: vi.fn().mockResolvedValue(null),
      transferUploadFilesFingerprint: vi.fn().mockReturnValue("fingerprint"),
    }));
    vi.doMock("@/features/transfers/upload.server", () => ({
      applyTransferAssetGroups: (files: unknown[]) => ({ files, groups: [] }),
      processUploadedFile,
      sortTransferFiles: (files: unknown[]) => files,
      isSafeTransferFilename: () => true,
    }));
    vi.doMock("@/features/transfers/media-state", () => ({
      HEIF_TRANSFER_UPLOAD_ERROR:
        "HEIC/HIF transfer uploads must be converted in the browser before upload.",
      buildTransferProcessingCounts: vi.fn().mockReturnValue({
        readyCount: 1,
        queuedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        originalOnlyCount: 1,
      }),
      isHeifUploadLike: vi.fn().mockReturnValue(false),
      resolveTransferUploadIds: (files: Array<{ name: string }>) =>
        files.map((file) => ({ ...file, mediaId: file.name.replace(/\.[^.]+$/, "") })),
    }));
    vi.doMock("@/lib/shared/config", () => ({
      getBaseUrlForRequest: (req: { url: string }) => new URL(req.url).origin,
      hasMediaPublicUrl: () => true,
    }));
    vi.doMock("@/lib/platform/api-error", () => ({
      apiErrorFromRequest: vi.fn(),
    }));

    const { POST } = await import("@/src/routes/api/upload/transfer/finalize/route");
    const response = await POST(
      makeRequest({
        transferId: "transfer-1",
        deleteToken: "delete-token",
        title: "party",
        expiresSeconds: 3600,
        files: [{ name: "photo.jpg", size: 123, type: "image/jpeg" }],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      deduplicated: true,
      transfer: { id: "transfer-1", fileCount: 1 },
    });
    expect(createTransfer).not.toHaveBeenCalled();
    expect(processUploadedFile).not.toHaveBeenCalled();
  });
});
