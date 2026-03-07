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
});
