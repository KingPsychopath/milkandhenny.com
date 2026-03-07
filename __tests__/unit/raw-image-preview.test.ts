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

async function makeEmbeddedJpegRawLikeBuffer(width: number, height: number): Promise<Buffer> {
  const jpeg = await makeJpegBuffer(width, height);
  return Buffer.concat([
    Buffer.from("RAWHEADER"),
    jpeg,
    Buffer.from("RAWTRAILER"),
  ]);
}

async function makeDngLikeTiffWithSubIfdPreview(width: number, height: number): Promise<Buffer> {
  const jpeg = await makeJpegBuffer(width, height);

  const ifd0Offset = 8;
  const ifd0EntryCount = 1;
  const ifd0Size = 2 + ifd0EntryCount * 12 + 4;
  const subIfdOffset = ifd0Offset + ifd0Size;
  const subIfdEntryCount = 2;
  const subIfdSize = 2 + subIfdEntryCount * 12 + 4;
  const jpegOffset = subIfdOffset + subIfdSize;
  const buffer = Buffer.alloc(jpegOffset);

  buffer.write("II", 0, "ascii");
  buffer.writeUInt16LE(42, 2);
  buffer.writeUInt32LE(ifd0Offset, 4);

  buffer.writeUInt16LE(ifd0EntryCount, ifd0Offset);
  buffer.writeUInt16LE(0x014a, ifd0Offset + 2);
  buffer.writeUInt16LE(4, ifd0Offset + 4);
  buffer.writeUInt32LE(1, ifd0Offset + 6);
  buffer.writeUInt32LE(subIfdOffset, ifd0Offset + 10);
  buffer.writeUInt32LE(0, ifd0Offset + 14);

  buffer.writeUInt16LE(subIfdEntryCount, subIfdOffset);
  buffer.writeUInt16LE(0x0201, subIfdOffset + 2);
  buffer.writeUInt16LE(4, subIfdOffset + 4);
  buffer.writeUInt32LE(1, subIfdOffset + 6);
  buffer.writeUInt32LE(jpegOffset, subIfdOffset + 10);
  buffer.writeUInt16LE(0x0202, subIfdOffset + 14);
  buffer.writeUInt16LE(4, subIfdOffset + 16);
  buffer.writeUInt32LE(1, subIfdOffset + 18);
  buffer.writeUInt32LE(jpeg.length, subIfdOffset + 22);
  buffer.writeUInt32LE(0, subIfdOffset + 26);

  return Buffer.concat([buffer, jpeg]);
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

  it("accepts a low-resolution thumbnail when it is the only available preview", async () => {
    const preview = await makeJpegBuffer(160, 120);
    vi.doMock("exifr", () => ({
      default: {
        thumbnail: vi.fn().mockResolvedValue(preview),
      },
    }));

    const { processToWebP } = await importProcessingModule();
    const result = await processToWebP(Buffer.from("raw"), "IMG_3001.dng");

    expect(result.width).toBe(160);
    expect(result.height).toBe(120);
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

  it("falls back to the legacy embedded-jpeg parser when exifr finds nothing", async () => {
    const rawLike = await makeEmbeddedJpegRawLikeBuffer(1200, 800);
    vi.doMock("exifr", () => ({
      default: {
        thumbnail: vi.fn().mockResolvedValue(undefined),
      },
    }));

    const { processToWebP } = await importProcessingModule();
    const result = await processToWebP(rawLike, "IMG_3003.arw");

    expect(result.width).toBe(1200);
    expect(result.height).toBe(800);
  });

  it("falls back to the legacy DNG TIFF preview parser when exifr finds nothing", async () => {
    const dngLike = await makeDngLikeTiffWithSubIfdPreview(1400, 900);
    vi.doMock("exifr", () => ({
      default: {
        thumbnail: vi.fn().mockResolvedValue(undefined),
      },
    }));

    const { processToWebP } = await importProcessingModule();
    const result = await processToWebP(dngLike, "IMG_3004.dng");

    expect(result.width).toBe(1400);
    expect(result.height).toBe(900);
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
