import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

async function makeJpegBuffer(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 220, g: 140, b: 40 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

function mockExiftool(resolver: (tag: string) => Buffer | Error): void {
  vi.doMock("child_process", () => ({
    execFile: vi.fn(
      (
        _bin: string,
        args: string[],
        _opts: unknown,
        callback: (error: Error | null, stdout: Buffer, stderr: Buffer) => void,
      ) => {
        const result = resolver(args[1] ?? "");
        if (result instanceof Error) callback(result, Buffer.alloc(0), Buffer.alloc(0));
        else callback(null, result, Buffer.alloc(0));
      },
    ),
  }));
}

describe("raw image preview processing", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("converts a usable exiftool preview to webp", async () => {
    const preview = await makeJpegBuffer(1800, 1200);
    mockExiftool(() => preview);
    const { processToWebP } = await import("@/features/media/processing.server");

    const result = await processToWebP(Buffer.from("raw"), "IMG_2869.dng");
    expect((await sharp(result.buffer).metadata()).format).toBe("webp");
    expect(result.width).toBe(1600);
    expect(result.height).toBe(1067);
  });

  it("creates image variants from a usable raw preview", async () => {
    const preview = await makeJpegBuffer(1800, 1200);
    mockExiftool(() => preview);
    const { processImageVariants } = await import("@/features/media/processing.server");

    const result = await processImageVariants(Buffer.from("raw"), ".dng");
    expect(result.thumb.contentType).toBe("image/webp");
    expect(result.full.contentType).toBe("image/webp");
    expect(result.width).toBe(1800);
    expect(result.height).toBe(1200);
  });

  it("falls back from PreviewImage to JpgFromRaw", async () => {
    const preview = await makeJpegBuffer(1400, 900);
    mockExiftool((tag) => (tag === "-JpgFromRaw" ? preview : new Error("tag missing")));
    const { processToWebP } = await import("@/features/media/processing.server");

    const result = await processToWebP(Buffer.from("raw"), "IMG_3001.arw");
    expect(result.width).toBe(1400);
    expect(result.height).toBe(900);
  });

  it("rejects missing or unusably small embedded previews", async () => {
    const tiny = await makeJpegBuffer(160, 120);
    mockExiftool((tag) => (tag === "-PreviewImage" ? tiny : new Error("tag missing")));
    const { RawPreviewUnavailableError, processToWebP } =
      await import("@/features/media/processing.server");

    await expect(processToWebP(Buffer.from("raw"), "IMG_3002.dng")).rejects.toBeInstanceOf(
      RawPreviewUnavailableError,
    );
  });

  it("keeps non-raw images unaffected without invoking exiftool", async () => {
    const raw = await makeJpegBuffer(640, 480);
    const execFile = vi.fn();
    vi.doMock("child_process", () => ({ execFile }));
    const { processToWebP } = await import("@/features/media/processing.server");

    const result = await processToWebP(raw, "photo.jpg");
    expect((await sharp(result.buffer).metadata()).format).toBe("webp");
    expect(result.width).toBe(640);
    expect(result.height).toBe(480);
    expect(execFile).not.toHaveBeenCalled();
  });
});
