import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  downloadBuffer,
  processImageVariants,
  processRawWithDcraw,
  saveTransfer,
  uploadBuffer,
} = vi.hoisted(() => {
  class MockRawPreviewUnavailableError extends Error {
    constructor() {
      super("raw preview unavailable");
      this.name = "RawPreviewUnavailableError";
    }
  }

  return {
    RawPreviewUnavailableError: MockRawPreviewUnavailableError,
    downloadBuffer: vi.fn(),
    processImageVariants: vi.fn(),
    processRawWithDcraw: vi.fn(),
    saveTransfer: vi.fn(),
    uploadBuffer: vi.fn(),
  };
});

vi.mock("@/lib/platform/r2", () => ({
  downloadBuffer,
  headObject: vi.fn(),
  uploadBuffer,
}));

vi.mock("@/features/transfers/store", () => ({
  saveTransfer,
}));

vi.mock("@/features/media/processing", () => {
  class MockRawPreviewUnavailableError extends Error {
    constructor() {
      super("raw preview unavailable");
      this.name = "RawPreviewUnavailableError";
    }
  }

  return {
    RawPreviewUnavailableError: MockRawPreviewUnavailableError,
    getFileKind: () => "image",
    getMimeType: () => "image/x-adobe-dng",
    processGifThumb: vi.fn(),
    processImageVariants,
    processRawWithDcraw,
    processVideoVariants: vi.fn(),
  };
});

describe("local transfer backfill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries failed raw files during local backfill", async () => {
    const { createLocalMediaProcessor } = await import("@/features/media/backends/local");

    downloadBuffer.mockResolvedValue(Buffer.from("raw"));
    processImageVariants
      .mockRejectedValueOnce(new (await import("@/features/media/processing")).RawPreviewUnavailableError(".dng", "missing"))
      .mockResolvedValueOnce({
        thumb: { buffer: Buffer.from("thumb"), contentType: "image/webp" },
        full: { buffer: Buffer.from("full"), contentType: "image/webp" },
        width: 2400,
        height: 1600,
        takenAt: null,
      });
    processRawWithDcraw.mockResolvedValue({
      buffer: Buffer.from("decoded"),
      width: 2400,
      height: 1600,
    });

    const processor = createLocalMediaProcessor();
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
          processingStatus: "failed" as const,
          processingRoute: "raw_try_local" as const,
          processingErrorCode: "raw_preview_unavailable",
          retryCount: 0,
        },
      ],
    };

    const updated = await processor.backfillTransferMedia(transfer);

    expect(updated.files[0]).toMatchObject({
      id: "capture",
      processingStatus: "local_done",
      previewStatus: "ready",
      processingRoute: "raw_try_local",
    });
    expect(uploadBuffer).toHaveBeenCalledTimes(2);
    expect(saveTransfer).toHaveBeenCalled();
  });
});
