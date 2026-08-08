import { beforeEach, describe, expect, it, vi } from "vitest";

describe("transfer raw preview handling", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("maps missing raw previews to original_only with a specific error code", async () => {
    vi.doMock("@/lib/platform/r2.server", () => ({
      downloadBuffer: vi.fn(),
      headObject: vi.fn(),
      uploadBuffer: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock("@/features/media/processing.server", async () => {
      const actual = await vi.importActual<typeof import("@/features/media/processing.server")>(
        "@/features/media/processing.server",
      );
      return {
        ...actual,
        processImageVariants: vi
          .fn()
          .mockRejectedValue(new actual.RawPreviewUnavailableError(".dng", "missing")),
      };
    });

    const { processTransferBufferLocally } =
      await import("@/features/transfers/media-backends/local.server");
    const result = await processTransferBufferLocally(
      Buffer.from("raw"),
      "capture.dng",
      "transfer-1",
    );

    expect(result.file.previewStatus).toBe("original_only");
    expect(result.file.processingStatus).toBe("failed");
    expect(result.file.processingErrorCode).toBe("raw_preview_unavailable");
    expect(result.file.storageKey).toBe("transfers/transfer-1/originals/capture.dng");
  });

  it("does not retry a raw file whose preview is genuinely missing", async () => {
    const uploadBuffer = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/platform/r2.server", () => ({
      downloadBuffer: vi.fn(),
      headObject: vi.fn(),
      uploadBuffer,
    }));

    const processImageVariants = vi.fn();
    vi.doMock("@/features/media/processing.server", async () => {
      const actual = await vi.importActual<typeof import("@/features/media/processing.server")>(
        "@/features/media/processing.server",
      );
      processImageVariants.mockRejectedValue(
        new actual.RawPreviewUnavailableError(".dng", "monochrome"),
      );
      return { ...actual, processImageVariants };
    });

    const { processTransferBufferLocally } =
      await import("@/features/transfers/media-backends/local.server");
    const result = await processTransferBufferLocally(
      Buffer.from("raw"),
      "capture.dng",
      "transfer-1",
    );

    // The embedded preview is the only decoder we have, so a second attempt
    // would run the same exiftool call for the same answer.
    expect(processImageVariants).toHaveBeenCalledTimes(1);
    expect(result.file.previewStatus).toBe("original_only");
    expect(result.file.processingErrorCode).toBe("raw_preview_unavailable");
    expect(uploadBuffer).not.toHaveBeenCalledWith(
      "transfers/transfer-1/thumb/capture.webp",
      expect.anything(),
      expect.anything(),
    );
  });

  it("treats a missing exiftool as an unavailable preview, not a crash", async () => {
    vi.doMock("@/lib/platform/r2.server", () => ({
      downloadBuffer: vi.fn(),
      headObject: vi.fn(),
      uploadBuffer: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock("@/features/media/processing.server", async () => {
      const actual = await vi.importActual<typeof import("@/features/media/processing.server")>(
        "@/features/media/processing.server",
      );
      return {
        ...actual,
        processImageVariants: vi.fn().mockRejectedValue(new Error("spawn exiftool ENOENT")),
      };
    });

    const { processTransferBufferLocally } =
      await import("@/features/transfers/media-backends/local.server");
    const result = await processTransferBufferLocally(
      Buffer.from("raw"),
      "capture.dng",
      "transfer-1",
    );

    expect(result.file.previewStatus).toBe("original_only");
    expect(result.file.processingErrorCode).toBe("raw_preview_unavailable");
  });
});
