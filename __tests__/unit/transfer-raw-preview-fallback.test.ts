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

  it("upgrades a client-derived raw preview when the archived raw yields a better server preview", async () => {
    const uploadBuffer = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/platform/r2", () => ({
      downloadBuffer: vi.fn().mockImplementation(async (key: string) => {
        if (key === "transfers/transfer-1/derived/capture.jpg") {
          return Buffer.from("derived-preview");
        }
        if (key === "transfers/transfer-1/originals/capture.dng") {
          return Buffer.from("archived-raw");
        }
        throw new Error(`Unexpected key: ${key}`);
      }),
      headObject: vi.fn(),
      uploadBuffer,
    }));

    vi.doMock("@/features/media/processing", async () => {
      const actual = await vi.importActual<typeof import("@/features/media/processing")>(
        "@/features/media/processing"
      );
      return {
        ...actual,
        processImageVariants: vi.fn().mockImplementation(async (_buffer: Buffer, source: string) => {
          if (source === "capture.jpg") {
            return {
              thumb: { buffer: Buffer.from("thumb-low"), contentType: "image/webp", ext: ".webp" },
              full: { buffer: Buffer.from("full-low"), contentType: "image/webp", ext: ".webp" },
              original: { buffer: Buffer.from("orig-low"), contentType: "image/jpeg", ext: ".jpg" },
              og: { buffer: Buffer.from("og-low"), contentType: "image/jpeg", ext: ".jpg" },
              width: 160,
              height: 120,
              takenAt: null,
              blur: "blur-low",
            };
          }
          if (source === "capture.dng") {
            return {
              thumb: { buffer: Buffer.from("thumb-high"), contentType: "image/webp", ext: ".webp" },
              full: { buffer: Buffer.from("full-high"), contentType: "image/webp", ext: ".webp" },
              original: { buffer: Buffer.from("orig-high"), contentType: "image/jpeg", ext: ".jpg" },
              og: { buffer: Buffer.from("og-high"), contentType: "image/jpeg", ext: ".jpg" },
              width: 1400,
              height: 933,
              takenAt: null,
              blur: "blur-high",
            };
          }
          throw new Error(`Unexpected source: ${source}`);
        }),
      };
    });

    const { processTransferObjectLocally } = await import("@/features/media/backends/local");
    const result = await processTransferObjectLocally(
      {
        name: "capture.jpg",
        size: 1024,
        type: "image/jpeg",
        originalName: "capture.dng",
        originalSize: 4096,
        originalType: "image/x-adobe-dng",
        convertedFrom: "raw",
      },
      "transfer-1"
    );

    expect(result.file.previewStatus).toBe("ready");
    expect(result.file.width).toBe(1400);
    expect(result.file.height).toBe(933);
    expect(result.file.previewSource).toBe("server_raw");
    expect(uploadBuffer).toHaveBeenCalledWith(
      "transfers/transfer-1/thumb/capture.webp",
      Buffer.from("thumb-high"),
      "image/webp"
    );
    expect(uploadBuffer).toHaveBeenCalledWith(
      "transfers/transfer-1/full/capture.webp",
      Buffer.from("full-high"),
      "image/webp"
    );
  });

  it("marks client-derived raw previews when the archived raw does not improve them", async () => {
    vi.doMock("@/lib/platform/r2", () => ({
      downloadBuffer: vi.fn().mockImplementation(async (key: string) => {
        if (key === "transfers/transfer-1/derived/capture.jpg") {
          return Buffer.from("derived-preview");
        }
        if (key === "transfers/transfer-1/originals/capture.dng") {
          return Buffer.from("archived-raw");
        }
        throw new Error(`Unexpected key: ${key}`);
      }),
      headObject: vi.fn(),
      uploadBuffer: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock("@/features/media/processing", async () => {
      const actual = await vi.importActual<typeof import("@/features/media/processing")>(
        "@/features/media/processing"
      );
      return {
        ...actual,
        processImageVariants: vi.fn().mockImplementation(async (_buffer: Buffer, source: string) => {
          if (source === "capture.jpg") {
            return {
              thumb: { buffer: Buffer.from("thumb-client"), contentType: "image/webp", ext: ".webp" },
              full: { buffer: Buffer.from("full-client"), contentType: "image/webp", ext: ".webp" },
              original: { buffer: Buffer.from("orig-client"), contentType: "image/jpeg", ext: ".jpg" },
              og: { buffer: Buffer.from("og-client"), contentType: "image/jpeg", ext: ".jpg" },
              width: 1600,
              height: 1067,
              takenAt: null,
              blur: "blur-client",
            };
          }
          if (source === "capture.dng") {
            return {
              thumb: { buffer: Buffer.from("thumb-server"), contentType: "image/webp", ext: ".webp" },
              full: { buffer: Buffer.from("full-server"), contentType: "image/webp", ext: ".webp" },
              original: { buffer: Buffer.from("orig-server"), contentType: "image/jpeg", ext: ".jpg" },
              og: { buffer: Buffer.from("og-server"), contentType: "image/jpeg", ext: ".jpg" },
              width: 1024,
              height: 683,
              takenAt: null,
              blur: "blur-server",
            };
          }
          throw new Error(`Unexpected source: ${source}`);
        }),
      };
    });

    const { processTransferObjectLocally } = await import("@/features/media/backends/local");
    const result = await processTransferObjectLocally(
      {
        name: "capture.jpg",
        size: 1024,
        type: "image/jpeg",
        originalName: "capture.dng",
        originalSize: 4096,
        originalType: "image/x-adobe-dng",
        convertedFrom: "raw",
      },
      "transfer-1"
    );

    expect(result.file.previewStatus).toBe("ready");
    expect(result.file.width).toBe(1600);
    expect(result.file.height).toBe(1067);
    expect(result.file.previewSource).toBe("client_raw");
  });
});
