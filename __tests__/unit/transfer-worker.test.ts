import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  dequeueTransferMediaJobs,
  enqueueTransferMediaJob,
  getTransfer,
  getTransferMediaQueueLength,
  processImageVariants,
  processRawWithDcraw,
  saveTransfer,
  uploadBuffer,
} = vi.hoisted(() => ({
  dequeueTransferMediaJobs: vi.fn(),
  enqueueTransferMediaJob: vi.fn(),
  getTransfer: vi.fn(),
  getTransferMediaQueueLength: vi.fn(),
  processImageVariants: vi.fn(),
  processRawWithDcraw: vi.fn(),
  saveTransfer: vi.fn(),
  uploadBuffer: vi.fn(),
}));

vi.mock("@/lib/platform/r2", () => ({
  downloadBuffer: vi.fn().mockResolvedValue(Buffer.from("raw")),
  uploadBuffer,
}));

vi.mock("@/features/transfers/media-queue", () => ({
  dequeueTransferMediaJobs,
  enqueueTransferMediaJob,
  getTransferMediaQueueLength,
}));

vi.mock("@/features/transfers/store", () => ({
  getTransfer,
  saveTransfer,
}));

vi.mock("@/features/media/processing", () => ({
  getMimeType: (filename: string) => (filename.endsWith(".mov") ? "video/quicktime" : "image/jpeg"),
  processImageVariants,
  processRawWithDcraw,
}));

vi.mock("@/features/media/backends/local", () => ({
  buildOriginalOnlyFailureFile: vi.fn(
    (mediaId: string, filename: string, size: number, storageKey: string, route: string, code: string, retryCount: number) => ({
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
    })
  ),
  buildReadyVisualFile: vi.fn(
    (mediaId: string, filename: string, size: number, kind: string, mimeType: string, storageKey: string, _originalStorageKey: string | undefined, width: number, height: number, route: string, processingStatus: string, processingBackend: string) => ({
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
    })
  ),
  getRouteKind: vi.fn((route: string) => (route.includes("video") ? "video" : route.includes("gif") ? "gif" : "image")),
  processTransferObjectLocally: vi.fn(),
}));

describe("worker media processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTransferMediaQueueLength.mockResolvedValue(0);
  });

  it("persists mediaId on queued jobs and remaps local video to worker_video", async () => {
    const { enqueueWorkerJob } = await import("@/features/media/backends/worker");

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
      })
    );
    expect(result.file.id).toBe("clip-2");
    expect(result.file.processingRoute).toBe("worker_video");
  });

  it("matches worker jobs by mediaId when filenames collide", async () => {
    const { runTransferMediaJobs } = await import("@/features/media/backends/worker");

    dequeueTransferMediaJobs.mockResolvedValue([
      {
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
        processingRoute: "worker_raw",
        attempt: 1,
        enqueuedAt: new Date().toISOString(),
      },
    ]);
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
    processRawWithDcraw.mockResolvedValue({
      buffer: Buffer.from("decoded"),
      width: 3000,
      height: 2000,
    });
    processImageVariants.mockResolvedValue({
      thumb: { buffer: Buffer.from("thumb"), contentType: "image/webp" },
      full: { buffer: Buffer.from("full"), contentType: "image/webp" },
      width: 3000,
      height: 2000,
      takenAt: null,
    });

    const result = await runTransferMediaJobs(1);

    expect(uploadBuffer).toHaveBeenNthCalledWith(
      1,
      "transfers/transfer-1/thumb/photo-2.webp",
      expect.any(Buffer),
      "image/webp"
    );
    expect(uploadBuffer).toHaveBeenNthCalledWith(
      2,
      "transfers/transfer-1/full/photo-2.webp",
      expect.any(Buffer),
      "image/webp"
    );
    expect(saveTransfer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        files: expect.arrayContaining([
          expect.objectContaining({
            id: "photo-2",
            processingStatus: "worker_done",
          }),
        ]),
      }),
      expect.any(Number)
    );
    expect(result.succeeded).toBe(1);
  });

  it("marks stale exhausted files as failed instead of leaving them queued", async () => {
    const { refreshQueuedTransferState } = await import("@/features/media/backends/worker");

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
    expect(saveTransfer).toHaveBeenCalled();
  });
});
