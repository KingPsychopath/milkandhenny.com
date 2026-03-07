import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

async function makeJpegBuffer(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 220, g: 140, b: 40 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function importProcessingModule() {
  return import("@/features/media/processing");
}

describe("raw image preview processing", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("converts a usable exifr thumbnail to webp", async () => {
    const preview = await makeJpegBuffer(1800, 1200);
    vi.doMock("exifr", () => ({
      default: {
        thumbnail: vi.fn().mockResolvedValue(preview),
      },
    }));

    const { processToWebP } = await importProcessingModule();
    const result = await processToWebP(Buffer.from("raw"), "IMG_2869.dng");
    const metadata = await sharp(result.buffer).metadata();

    expect(metadata.format).toBe("webp");
    expect(result.width).toBe(1600);
    expect(result.height).toBe(1067);
  });

  it("creates variants from a usable raw preview", async () => {
    const preview = await makeJpegBuffer(1800, 1200);
    vi.doMock("exifr", () => ({
      default: {
        thumbnail: vi.fn().mockResolvedValue(preview),
      },
    }));

    const { processImageVariants } = await importProcessingModule();
    const result = await processImageVariants(Buffer.from("raw"), ".dng");

    expect(result.thumb.contentType).toBe("image/webp");
    expect(result.full.contentType).toBe("image/webp");
    expect(result.width).toBe(1800);
    expect(result.height).toBe(1200);
  });

  it("throws when exifr only returns a low-resolution thumbnail", async () => {
    const preview = await makeJpegBuffer(160, 120);
    vi.doMock("exifr", () => ({
      default: {
        thumbnail: vi.fn().mockResolvedValue(preview),
      },
    }));

    const { RawPreviewUnavailableError, processToWebP } = await importProcessingModule();

    await expect(processToWebP(Buffer.from("raw"), "IMG_3001.dng")).rejects.toBeInstanceOf(
      RawPreviewUnavailableError
    );
  });

  it("throws when exifr finds no embedded preview", async () => {
    vi.doMock("exifr", () => ({
      default: {
        thumbnail: vi.fn().mockResolvedValue(undefined),
      },
    }));

    const { RawPreviewUnavailableError, processToWebP } = await importProcessingModule();

    await expect(processToWebP(Buffer.from("raw"), "IMG_3002.dng")).rejects.toBeInstanceOf(
      RawPreviewUnavailableError
    );
  });

  it("keeps non-raw images unaffected", async () => {
    const raw = await makeJpegBuffer(640, 480);
    const { processToWebP } = await importProcessingModule();

    const result = await processToWebP(raw, "photo.jpg");
    const metadata = await sharp(result.buffer).metadata();

    expect(metadata.format).toBe("webp");
    expect(result.width).toBe(640);
    expect(result.height).toBe(480);
  });
});
