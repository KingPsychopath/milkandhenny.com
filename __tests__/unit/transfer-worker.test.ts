import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  deleteObjects,
  enqueueTransferMediaJob,
  getTransfer,
  processImageVariants,
  resolveImageProcessingSource,
  updateTransferFile,
  uploadBuffer,
} = vi.hoisted(() => ({
  deleteObjects: vi.fn(),
  enqueueTransferMediaJob: vi.fn(),
  getTransfer: vi.fn(),
  processImageVariants: vi.fn(),
  resolveImageProcessingSource: vi.fn(),
  updateTransferFile: vi.fn().mockResolvedValue(true),
  uploadBuffer: vi.fn(),
}));

vi.mock("@/lib/platform/r2.server", () => ({
  deleteObjects,
  downloadBuffer: vi.fn().mockResolvedValue(Buffer.from("raw")),
  uploadBuffer,
}));

vi.mock("@/features/transfers/media-queue.server", () => ({
  enqueueTransferMediaJob,
}));

vi.mock("@/features/transfers/store.server", () => ({
  getTransfer,
  updateTransferFile,
}));

vi.mock("@/features/media/processing.server", () => ({
  RawPreviewUnavailableError: class RawPreviewUnavailableError extends Error {},
  getMimeType: (filename: string) => (filename.endsWith(".mov") ? "video/quicktime" : "image/jpeg"),
  mapConcurrent: async <T, R>(items: T[], _limit: number, mapper: (item: T) => Promise<R>) =>
    Promise.all(items.map((item) => mapper(item))),
  processImageVariants,
  resolveImageProcessingSource,
}));

vi.mock("@/features/transfers/media-backends/local.server", () => ({
  buildOriginalOnlyFailureFile: vi.fn(
    (
      mediaId: string,
      filename: string,
      size: number,
      storageKey: string,
      route: string,
      code: string,
      retryCount: number,
    ) => ({
      id: mediaId,
      filename,
      kind: "image",
      size,
      mimeType: "image/jpeg",
      storageKey,
      previewStatus: "original_only",
      processingStatus: "failed",
      processingRoute: route,
      processingErrorCode: code,
      retryCount,
    }),
  ),
  buildReadyVisualFile: vi.fn(
    (
      mediaId: string,
      filename: string,
      size: number,
      kind: string,
      mimeType: string,
      storageKey: string,
      _originalStorageKey: string | undefined,
      width: number,
      height: number,
      route: string,
      processingStatus: string,
      processingBackend: string,
    ) => ({
      id: mediaId,
      filename,
      kind,
      size,
      mimeType,
      storageKey,
      width,
      height,
      previewStatus: "ready",
      processingStatus,
      processingBackend,
      processingRoute: route,
    }),
  ),
  getRouteKind: vi.fn((route: string) =>
    route.includes("video") ? "video" : route.includes("gif") ? "gif" : "image",
  ),
  processTransferObjectLocally: vi.fn(),
}));

describe("worker media processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateTransferFile.mockResolvedValue(true);
    deleteObjects.mockResolvedValue(2);
  });

  it("persists mediaId on queued jobs and remaps local video to worker_video", async () => {
    const { enqueueWorkerJob } = await import("@/features/transfers/media-backends/worker.server");

    enqueueTransferMediaJob.mockResolvedValue(undefined);

    const result = await enqueueWorkerJob({
      transferId: "transfer-1",
      file: {
        name: "clip.mov",
        mediaId: "clip-2",
        size: 128,
        type: "video/quicktime",
      },
      route: "local_video",
    });

    expect(enqueueTransferMediaJob).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: "clip-2",
        processingRoute: "worker_video",
      }),
    );
    expect(result.file.id).toBe("clip-2");
    expect(result.file.processingRoute).toBe("worker_video");
  });

  it("should retry a fresh job until its file metadata is visible", async () => {
    const { processWorkerJob } = await import("@/features/transfers/media-backends/worker.server");
    getTransfer.mockResolvedValue({
      id: "transfer-1",
      title: "transfer",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      deleteToken: "token",
      files: [],
    });

    await expect(
      processWorkerJob({
        transferId: "transfer-1",
        mediaId: "clip",
        file: {
          name: "clip.mov",
          mediaId: "clip",
          size: 512,
          type: "video/quicktime",
        },
        storageKey: "transfers/transfer-1/original/clip.mov",
        mimeType: "video/quicktime",
        processingRoute: "worker_video",
        attempt: 1,
        enqueuedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow("Transfer file metadata is not visible yet");
  });

  it("should advance the retry generation when a queued file becomes stale", async () => {
    const { refreshQueuedTransferState } =
      await import("@/features/transfers/media-backends/worker.server");
    enqueueTransferMediaJob.mockResolvedValue(undefined);
    const transfer = {
      id: "transfer-1",
      title: "transfer",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      deleteToken: "token",
      files: [
        {
          id: "clip",
          filename: "clip.mov",
          kind: "video" as const,
          size: 512,
          mimeType: "video/quicktime",
          storageKey: "transfers/transfer-1/original/clip.mov",
          previewStatus: "original_only" as const,
          processingStatus: "queued" as const,
          processingRoute: "worker_video" as const,
          enqueuedAt: new Date(Date.now() - 16 * 60_000).toISOString(),
          retryCount: 0,
        },
      ],
    };

    const updated = await refreshQueuedTransferState(transfer);

    expect(enqueueTransferMediaJob).toHaveBeenCalledWith(expect.objectContaining({ attempt: 2 }));
    expect(updated.files[0]).toMatchObject({ processingStatus: "queued", retryCount: 1 });
  });

  it("matches worker jobs by mediaId when filenames collide", async () => {
    const { processWorkerJob } = await import("@/features/transfers/media-backends/worker.server");

    const job = {
      transferId: "transfer-1",
      mediaId: "photo-2",
      file: {
        name: "photo.jpg",
        mediaId: "photo-2",
        size: 512,
        type: "image/x-adobe-dng",
        originalName: "photo.dng",
      },
      storageKey: "transfers/transfer-1/originals/photo.dng",
      mimeType: "image/x-adobe-dng",
      processingRoute: "worker_raw" as const,
      attempt: 1,
      enqueuedAt: new Date().toISOString(),
    };
    getTransfer.mockResolvedValue({
      id: "transfer-1",
      title: "transfer",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      deleteToken: "token",
      files: [
        {
          id: "photo",
          filename: "photo.jpg",
          kind: "image",
          size: 256,
          mimeType: "image/jpeg",
          storageKey: "transfers/transfer-1/derived/photo.jpg",
          previewStatus: "ready",
          processingStatus: "worker_done",
          processingRoute: "worker_image",
        },
        {
          id: "photo-2",
          filename: "photo.jpg",
          kind: "image",
          size: 512,
          mimeType: "image/x-adobe-dng",
          storageKey: "transfers/transfer-1/originals/photo.dng",
          previewStatus: "original_only",
          processingStatus: "queued",
          processingRoute: "worker_raw",
        },
      ],
    });
    resolveImageProcessingSource.mockResolvedValue({
      buffer: Buffer.from("decoded"),
      takenAt: null,
    });
    processImageVariants.mockResolvedValue({
      thumb: { buffer: Buffer.from("thumb"), contentType: "image/webp" },
      full: { buffer: Buffer.from("full"), contentType: "image/webp" },
      width: 3000,
      height: 2000,
      takenAt: null,
    });

    const result = await processWorkerJob(job);

    expect(uploadBuffer).toHaveBeenNthCalledWith(
      1,
      "transfers/transfer-1/thumb/photo-2.webp",
      expect.any(Buffer),
      "image/webp",
      { scope: "private" },
    );
    expect(uploadBuffer).toHaveBeenNthCalledWith(
      2,
      "transfers/transfer-1/full/photo-2.webp",
      expect.any(Buffer),
      "image/webp",
      { scope: "private" },
    );
    expect(updateTransferFile).toHaveBeenLastCalledWith(
      "transfer-1",
      expect.objectContaining({ id: "photo-2", processingStatus: "worker_done" }),
    );
    expect(result).toBe("succeeded");
  });

  it("cleans generated variants when the file is deleted during processing", async () => {
    const { processWorkerJob } = await import("@/features/transfers/media-backends/worker.server");
    const expectedThumbKey = "transfers/transfer-1/thumb/photo-2.webp";
    const expectedFullKey = "transfers/transfer-1/full/photo-2.webp";

    const job = {
      transferId: "transfer-1",
      mediaId: "photo-2",
      file: {
        name: "photo.jpg",
        mediaId: "photo-2",
        size: 512,
        type: "image/x-adobe-dng",
        originalName: "photo.dng",
      },
      storageKey: "transfers/transfer-1/originals/photo.dng",
      expectedThumbKey,
      expectedFullKey,
      mimeType: "image/x-adobe-dng",
      processingRoute: "worker_raw" as const,
      attempt: 1,
      enqueuedAt: new Date().toISOString(),
    };
    getTransfer.mockResolvedValue({
      id: "transfer-1",
      title: "transfer",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      deleteToken: "token",
      files: [
        {
          id: "photo-2",
          filename: "photo.jpg",
          kind: "image",
          size: 512,
          mimeType: "image/x-adobe-dng",
          storageKey: "transfers/transfer-1/originals/photo.dng",
          previewStatus: "original_only",
          processingStatus: "queued",
          processingRoute: "worker_raw",
        },
      ],
    });
    resolveImageProcessingSource.mockResolvedValue({
      buffer: Buffer.from("decoded"),
      takenAt: null,
    });
    processImageVariants.mockResolvedValue({
      thumb: { buffer: Buffer.from("thumb"), contentType: "image/webp" },
      full: { buffer: Buffer.from("full"), contentType: "image/webp" },
      width: 3000,
      height: 2000,
      takenAt: null,
    });
    updateTransferFile.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const result = await processWorkerJob(job);

    expect(deleteObjects).toHaveBeenCalledWith([expectedThumbKey, expectedFullKey], {
      scope: "private",
    });
    expect(result).toBe("skipped");
  });

  it("records an Effect-owned worker deadline as a durable timeout failure", async () => {
    const { markWorkerJobTimedOut } =
      await import("@/features/transfers/media-backends/worker.server");
    const job = {
      transferId: "transfer-1",
      mediaId: "clip",
      file: {
        name: "clip.mov",
        mediaId: "clip",
        size: 512,
        type: "video/quicktime",
      },
      storageKey: "transfers/transfer-1/original/clip.mov",
      mimeType: "video/quicktime",
      processingRoute: "worker_video" as const,
      attempt: 1,
      enqueuedAt: new Date().toISOString(),
    };
    getTransfer.mockResolvedValue({
      id: "transfer-1",
      title: "transfer",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      deleteToken: "token",
      files: [
        {
          id: "clip",
          filename: "clip.mov",
          kind: "video",
          size: 512,
          mimeType: "video/quicktime",
          storageKey: "transfers/transfer-1/original/clip.mov",
          previewStatus: "original_only",
          processingStatus: "processing",
          processingRoute: "worker_video",
        },
      ],
    });

    await expect(markWorkerJobTimedOut(job, 250)).resolves.toBe("failed");
    expect(updateTransferFile).toHaveBeenCalledWith(
      "transfer-1",
      expect.objectContaining({
        id: "clip",
        processingStatus: "failed",
        processingErrorCode: "worker_timeout",
        processingErrorDetail: expect.stringContaining("timed out after 250ms"),
      }),
    );
  });

  it("marks stale exhausted files as failed instead of leaving them queued", async () => {
    const { refreshQueuedTransferState } =
      await import("@/features/transfers/media-backends/worker.server");

    const transfer = {
      id: "transfer-1",
      title: "transfer",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      deleteToken: "token",
      files: [
        {
          id: "capture",
          filename: "capture.dng",
          kind: "image" as const,
          size: 1024,
          mimeType: "image/x-adobe-dng",
          storageKey: "transfers/transfer-1/originals/capture.dng",
          previewStatus: "original_only" as const,
          processingStatus: "queued" as const,
          processingRoute: "worker_raw" as const,
          enqueuedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
          retryCount: 3,
        },
      ],
    };

    const updated = await refreshQueuedTransferState(transfer);

    expect(updated.files[0]).toMatchObject({
      processingStatus: "failed",
      processingErrorCode: "retries_exhausted",
      previewStatus: "original_only",
    });
    expect(updateTransferFile).toHaveBeenCalledWith(
      "transfer-1",
      expect.objectContaining({ processingErrorCode: "retries_exhausted" }),
    );
  });
});
