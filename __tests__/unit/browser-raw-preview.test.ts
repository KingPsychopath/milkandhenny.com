import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const exifrThumbnail = vi.fn();

vi.mock("exifr", () => ({
  thumbnail: exifrThumbnail,
}));

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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

describe("browser raw preview extraction", () => {
  const originalWindow = globalThis.window;
  const originalCreateImageBitmap = globalThis.createImageBitmap;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.assign(globalThis, { window: globalThis });
    Object.assign(globalThis, {
      createImageBitmap: vi.fn(async (blob: Blob) => {
        const buffer = Buffer.from(await blob.arrayBuffer());
        const metadata = await sharp(buffer).metadata();
        return {
          width: metadata.width ?? 0,
          height: metadata.height ?? 0,
          close() {},
        };
      }),
    });
  });

  afterEach(() => {
    Object.assign(globalThis, { createImageBitmap: originalCreateImageBitmap });
    Object.assign(globalThis, { window: originalWindow });
  });

  it("should prefer a larger embedded jpeg over a tiny exifr thumbnail", async () => {
    const tinyPreview = await makeJpegBuffer(160, 120);
    const rawLike = await makeEmbeddedJpegRawLikeBuffer(1400, 900);
    exifrThumbnail.mockResolvedValue(tinyPreview);

    const { prepareTransferUploadFile } = await import("@/features/transfers/browser-heif");
    const file = new File([toArrayBuffer(rawLike)], "capture.arw", {
      type: "image/x-sony-arw",
      lastModified: Date.now(),
    });
    const result = await prepareTransferUploadFile(file, { derivePreview: true });
    const previewBuffer = Buffer.from(await result.uploadFile.arrayBuffer());
    const metadata = await sharp(previewBuffer).metadata();

    expect(result.convertedFrom).toBe("raw");
    expect(result.uploadName).toBe("capture.jpg");
    expect(result.statusLabel).toContain("1400px");
    expect(metadata.width).toBe(1400);
    expect(metadata.height).toBe(900);
  });
});
