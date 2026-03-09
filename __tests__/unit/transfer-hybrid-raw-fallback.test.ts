import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  enqueueWorkerJob,
  getLocalProcessingTimeoutMs,
  inferCompatibleTransferFileState,
  processTransferBufferLocally,
  processTransferObjectLocally,
  refreshQueuedTransferState,
  requeueTransferFile,
  shouldRouteToWorkerFirst,
} = vi.hoisted(() => ({
  enqueueWorkerJob: vi.fn(),
  getLocalProcessingTimeoutMs: vi.fn(),
  inferCompatibleTransferFileState: vi.fn(),
  processTransferBufferLocally: vi.fn(),
  processTransferObjectLocally: vi.fn(),
  refreshQueuedTransferState: vi.fn(),
  requeueTransferFile: vi.fn(),
  shouldRouteToWorkerFirst: vi.fn(),
}));

vi.mock("@/features/media/config", () => ({
  getLocalProcessingTimeoutMs,
  shouldRouteToWorkerFirst,
}));

vi.mock("@/features/media/backends/local", () => ({
  inferCompatibleTransferFileState,
  processTransferBufferLocally,
  processTransferObjectLocally,
}));

vi.mock("@/features/media/backends/worker", () => ({
  enqueueWorkerJob,
  refreshQueuedTransferState,
  requeueTransferFile,
}));

import { createHybridMediaProcessor } from "@/features/media/backends/hybrid";

describe("hybrid transfer raw fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLocalProcessingTimeoutMs.mockReturnValue(0);
    shouldRouteToWorkerFirst.mockReturnValue(false);
    refreshQueuedTransferState.mockImplementation(async (transfer) => transfer);
  });

  it("queues raw uploads for worker decoding when local preview extraction fails", async () => {
    processTransferObjectLocally.mockResolvedValue({
      file: {
        id: "capture",
        filename: "capture.dng",
        kind: "image",
        size: 4096,
        mimeType: "image/x-adobe-dng",
        storageKey: "transfers/transfer-1/originals/capture.dng",
        previewStatus: "original_only",
        processingStatus: "failed",
        processingRoute: "raw_try_local",
        processingErrorCode: "raw_preview_unavailable",
      },
      uploadedBytes: 4096,
    });

    enqueueWorkerJob.mockResolvedValue({
      file: {
        id: "capture",
        filename: "capture.dng",
        kind: "image",
        size: 4096,
        mimeType: "image/x-adobe-dng",
        storageKey: "transfers/transfer-1/originals/capture.dng",
        previewStatus: "original_only",
        processingStatus: "queued",
        processingBackend: "worker",
        processingRoute: "worker_raw",
      },
      uploadedBytes: 4096,
    });

    const processor = createHybridMediaProcessor("hybrid");
    const result = await processor.processTransferObject(
      {
        name: "capture.dng",
        size: 4096,
        type: "image/x-adobe-dng",
      },
      "transfer-1"
    );

    expect(processTransferObjectLocally).toHaveBeenCalledWith(
      {
        name: "capture.dng",
        size: 4096,
        type: "image/x-adobe-dng",
      },
      "transfer-1",
      "local_done",
      "local",
      "raw_try_local"
    );
    expect(enqueueWorkerJob).toHaveBeenCalledWith({
      transferId: "transfer-1",
      file: {
        name: "capture.dng",
        size: 4096,
        type: "image/x-adobe-dng",
      },
      route: "raw_try_local",
    });
    expect(result.file.processingStatus).toBe("queued");
    expect(result.file.processingRoute).toBe("worker_raw");
  });

  it("queues direct raw buffers for worker decoding when local preview extraction fails", async () => {
    const buffer = Buffer.from("raw");

    processTransferBufferLocally.mockResolvedValue({
      file: {
        id: "capture",
        filename: "capture.dng",
        kind: "image",
        size: buffer.byteLength,
        mimeType: "image/x-adobe-dng",
        storageKey: "transfers/transfer-1/originals/capture.dng",
        previewStatus: "original_only",
        processingStatus: "failed",
        processingRoute: "raw_try_local",
        processingErrorCode: "raw_preview_unavailable",
      },
      uploadedBytes: buffer.byteLength,
    });

    enqueueWorkerJob.mockResolvedValue({
      file: {
        id: "capture",
        filename: "capture.dng",
        kind: "image",
        size: buffer.byteLength,
        mimeType: "image/x-adobe-dng",
        storageKey: "transfers/transfer-1/originals/capture.dng",
        previewStatus: "original_only",
        processingStatus: "queued",
        processingBackend: "worker",
        processingRoute: "worker_raw",
      },
      uploadedBytes: buffer.byteLength,
    });

    const processor = createHybridMediaProcessor("hybrid");
    const result = await processor.processTransferBuffer(
      buffer,
      {
        name: "capture.dng",
        size: buffer.byteLength,
        type: "image/x-adobe-dng",
      },
      "transfer-1"
    );

    expect(processTransferBufferLocally).toHaveBeenCalledWith(
      buffer,
      {
        name: "capture.dng",
        size: buffer.byteLength,
        type: "image/x-adobe-dng",
      },
      "transfer-1",
      "local_done",
      "local",
      "raw_try_local"
    );
    expect(enqueueWorkerJob).toHaveBeenCalledWith({
      transferId: "transfer-1",
      file: {
        name: "capture.dng",
        size: buffer.byteLength,
        type: "image/x-adobe-dng",
      },
      route: "raw_try_local",
      originalBuffer: buffer,
    });
    expect(result.file.processingStatus).toBe("queued");
    expect(result.file.processingRoute).toBe("worker_raw");
  });

  it("requeues failed raw files during backfill when retries remain", async () => {
    const transfer = {
      id: "transfer-1",
      title: "untitled",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      deleteToken: "token",
      files: [
        {
          id: "capture",
          filename: "capture.dng",
          kind: "image" as const,
          size: 4096,
          mimeType: "image/x-adobe-dng",
          storageKey: "transfers/transfer-1/originals/capture.dng",
          previewStatus: "original_only" as const,
          processingStatus: "failed" as const,
          processingRoute: "raw_try_local" as const,
          processingErrorCode: "raw_preview_unavailable",
          retryCount: 0,
        },
      ],
    };

    inferCompatibleTransferFileState.mockResolvedValue(transfer.files[0]);
    requeueTransferFile.mockResolvedValue({
      ...transfer.files[0],
      processingStatus: "queued",
      processingBackend: "worker",
      processingRoute: "worker_raw",
    });

    const processor = createHybridMediaProcessor("hybrid");
    const updated = await processor.backfillTransferMedia(transfer);

    expect(requeueTransferFile).toHaveBeenCalledWith(transfer, transfer.files[0]);
    expect(updated.files[0]?.processingStatus).toBe("queued");
    expect(updated.files[0]?.processingBackend).toBe("worker");
  });
});
