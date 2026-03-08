import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  enqueueWorkerJob,
  processTransferBufferLocally,
  processTransferObjectLocally,
  shouldRouteToWorkerFirst,
} = vi.hoisted(() => ({
  enqueueWorkerJob: vi.fn(),
  processTransferBufferLocally: vi.fn(),
  processTransferObjectLocally: vi.fn(),
  shouldRouteToWorkerFirst: vi.fn(),
}));

vi.mock("@/features/media/config", () => ({
  shouldRouteToWorkerFirst,
}));

vi.mock("@/features/media/backends/local", () => ({
  inferCompatibleTransferFileState: vi.fn(),
  processTransferBufferLocally,
  processTransferObjectLocally,
}));

vi.mock("@/features/media/backends/worker", () => ({
  enqueueWorkerJob,
  refreshQueuedTransferState: vi.fn(),
  requeueTransferFile: vi.fn(),
}));

import { createHybridMediaProcessor } from "@/features/media/backends/hybrid";

describe("hybrid transfer raw fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shouldRouteToWorkerFirst.mockReturnValue(false);
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
});
