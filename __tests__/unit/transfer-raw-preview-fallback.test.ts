import { beforeEach, describe, expect, it, vi } from "vitest";

describe("transfer raw preview fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("maps missing raw previews to original_only with a specific error code", async () => {
    vi.doMock("@/lib/platform/r2", () => ({
      downloadBuffer: vi.fn(),
      headObject: vi.fn(),
      uploadBuffer: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock("@/features/media/processing", async () => {
      const actual = await vi.importActual<typeof import("@/features/media/processing")>(
        "@/features/media/processing"
      );
      return {
        ...actual,
        processImageVariants: vi
          .fn()
          .mockRejectedValue(new actual.RawPreviewUnavailableError(".dng", "missing")),
      };
    });

    const { processTransferBufferLocally } = await import("@/features/media/backends/local");
    const result = await processTransferBufferLocally(Buffer.from("raw"), "capture.dng", "transfer-1");

    expect(result.file.previewStatus).toBe("original_only");
    expect(result.file.processingStatus).toBe("failed");
    expect(result.file.processingErrorCode).toBe("raw_preview_unavailable");
    expect(result.file.storageKey).toBe("transfers/transfer-1/originals/capture.dng");
  });
});
