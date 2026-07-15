import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

async function makeJpegBuffer(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 110, b: 100 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe("raw decoder resolution", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("uses the first usable exiftool preview", async () => {
    const decoded = await makeJpegBuffer(800, 600);
    const execFile = vi.fn(
      (
        bin: string,
        _args: string[],
        _opts: unknown,
        callback: (error: Error | null, stdout: Buffer, stderr: Buffer) => void,
      ) =>
        callback(
          bin === "exiftool" ? null : new Error("unexpected binary"),
          decoded,
          Buffer.alloc(0),
        ),
    );
    vi.doMock("child_process", () => ({ execFile }));

    const { processRawWithDcraw } = await import("@/features/media/processing.server");
    const result = await processRawWithDcraw(Buffer.from("raw"), "IMG_3006.dng");

    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile).toHaveBeenCalledWith(
      "exiftool",
      expect.arrayContaining(["-PreviewImage"]),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("reports an unavailable preview after all exiftool tags fail", async () => {
    const execFile = vi.fn(
      (
        _bin: string,
        _args: string[],
        _opts: unknown,
        callback: (error: Error, stdout: Buffer, stderr: Buffer) => void,
      ) => callback(new Error("missing tag"), Buffer.alloc(0), Buffer.alloc(0)),
    );
    vi.doMock("child_process", () => ({ execFile }));

    const { processRawWithDcraw } = await import("@/features/media/processing.server");
    await expect(processRawWithDcraw(Buffer.from("raw"), "IMG_3006.dng")).rejects.toThrow(
      "RAW preview unavailable for .dng",
    );
    expect(execFile).toHaveBeenCalledTimes(3);
  });
});
