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

  it("falls back to local raw decoding when embedded previews are unusable", async () => {
    const uploadBuffer = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/platform/r2", () => ({
      downloadBuffer: vi.fn(),
      headObject: vi.fn(),
      uploadBuffer,
    }));

    vi.doMock("@/features/media/processing", async () => {
      const actual = await vi.importActual<typeof import("@/features/media/processing")>(
        "@/features/media/processing"
      );
      return {
        ...actual,
        processImageVariants: vi
          .fn()
          .mockRejectedValueOnce(new actual.RawPreviewUnavailableError(".dng", "monochrome"))
          .mockResolvedValueOnce({
            thumb: { buffer: Buffer.from("thumb-decoded"), contentType: "image/webp", ext: ".webp" },
            full: { buffer: Buffer.from("full-decoded"), contentType: "image/webp", ext: ".webp" },
            original: { buffer: Buffer.from("orig-decoded"), contentType: "image/jpeg", ext: ".jpg" },
            og: { buffer: Buffer.from("og-decoded"), contentType: "image/jpeg", ext: ".jpg" },
            width: 2400,
            height: 1600,
            takenAt: null,
            blur: "blur-decoded",
          }),
        processRawWithDcraw: vi.fn().mockResolvedValue({
          buffer: Buffer.from("decoded-tiff"),
          width: 2400,
          height: 1600,
        }),
      };
    });

    const { processTransferBufferLocally } = await import("@/features/media/backends/local");
    const result = await processTransferBufferLocally(Buffer.from("raw"), "capture.dng", "transfer-1");

    expect(result.file.previewStatus).toBe("ready");
    expect(result.file.processingStatus).toBe("local_done");
    expect(result.file.previewSource).toBe("server_raw");
    expect(result.file.width).toBe(2400);
    expect(result.file.height).toBe(1600);
    expect(uploadBuffer).toHaveBeenCalledWith(
      "transfers/transfer-1/thumb/capture.webp",
      Buffer.from("thumb-decoded"),
      "image/webp"
    );
    expect(uploadBuffer).toHaveBeenCalledWith(
      "transfers/transfer-1/full/capture.webp",
      Buffer.from("full-decoded"),
      "image/webp"
    );
  });

  it("marks server-side HEIF uploads as original_only without attempting Sharp processing", async () => {
    const uploadBuffer = vi.fn().mockResolvedValue(undefined);
    const processImageVariants = vi.fn();

    vi.doMock("@/lib/platform/r2", () => ({
      downloadBuffer: vi.fn(),
      headObject: vi.fn(),
      uploadBuffer,
    }));

    vi.doMock("@/features/media/processing", async () => {
      const actual = await vi.importActual<typeof import("@/features/media/processing")>(
        "@/features/media/processing"
      );
      return {
        ...actual,
        processImageVariants,
      };
    });

    const { processTransferBufferLocally } = await import("@/features/media/backends/local");
    const result = await processTransferBufferLocally(
      Buffer.from("heif"),
      "DSC00001.HIF",
      "transfer-1"
    );

    expect(processImageVariants).not.toHaveBeenCalled();
    expect(result.file.previewStatus).toBe("original_only");
    expect(result.file.processingStatus).toBe("failed");
    expect(result.file.processingErrorCode).toBe("heif_server_unsupported");
    expect(result.file.storageKey).toBe("transfers/transfer-1/originals/DSC00001.HIF");
  });

});
