import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { processImageVariants, processToWebP } from "@/features/media/processing";

async function makeEmbeddedJpegRawLikeBuffer(): Promise<Buffer> {
  const jpeg = await sharp({
    create: {
      width: 120,
      height: 80,
      channels: 3,
      background: { r: 220, g: 140, b: 40 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();

  return Buffer.concat([
    Buffer.from("RAWHEADER"),
    jpeg,
    Buffer.from("RAWTRAILER"),
  ]);
}

async function makeDngLikeTiffWithSubIfdPreview(): Promise<Buffer> {
  const jpeg = await sharp({
    create: {
      width: 96,
      height: 64,
      channels: 3,
      background: { r: 90, g: 150, b: 210 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();

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

describe("raw image preview processing", () => {
  it("extracts an embedded jpeg preview for webp conversion", async () => {
    const rawLike = await makeEmbeddedJpegRawLikeBuffer();

    const result = await processToWebP(rawLike, "IMG_2869.dng");
    const metadata = await sharp(result.buffer).metadata();

    expect(metadata.format).toBe("webp");
    expect(result.width).toBe(120);
    expect(result.height).toBe(80);
  });

  it("creates transfer-style variants from an embedded jpeg preview", async () => {
    const rawLike = await makeEmbeddedJpegRawLikeBuffer();

    const result = await processImageVariants(rawLike, ".dng");

    expect(result.thumb.contentType).toBe("image/webp");
    expect(result.full.contentType).toBe("image/webp");
    expect(result.width).toBe(120);
    expect(result.height).toBe(80);
  });

  it("extracts a DNG preview from TIFF SubIFD metadata", async () => {
    const dngLike = await makeDngLikeTiffWithSubIfdPreview();

    const result = await processToWebP(dngLike, "IMG_3001.dng");
    const metadata = await sharp(result.buffer).metadata();

    expect(metadata.format).toBe("webp");
    expect(result.width).toBe(96);
    expect(result.height).toBe(64);
  });
});
