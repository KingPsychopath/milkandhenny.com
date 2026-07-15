import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

describe("embedded RAW preview exposure", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("keeps the camera-rendered preview exposure unchanged", async () => {
    const decoded = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 64, g: 64, b: 64 } },
    })
      .jpeg({ quality: 100 })
      .toBuffer();
    vi.doMock("child_process", () => ({
      execFile: vi.fn(
        (
          _bin: string,
          _args: string[],
          _opts: unknown,
          callback: (error: Error | null, stdout: Buffer, stderr: Buffer) => void,
        ) => callback(null, decoded, Buffer.alloc(0)),
      ),
    }));

    const { processRawWithDcraw } = await import("@/features/media/processing.server");
    const result = await processRawWithDcraw(Buffer.from("raw"), "IMG_3006.dng");
    const stats = await sharp(result.buffer).stats();

    expect(stats.channels[0].mean).toBeGreaterThan(50);
    expect(stats.channels[0].mean).toBeLessThan(90);
  });
});
