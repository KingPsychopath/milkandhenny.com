import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const { mockParse } = vi.hoisted(() => ({
  mockParse: vi.fn(),
}));

async function makeJpegBuffer(
  width: number,
  height: number,
  rgb: { r: number; g: number; b: number }
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: rgb,
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe("dcraw baseline exposure handling", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("applies positive DNG baseline exposure as a brightening gain", async () => {
    const decoded = await makeJpegBuffer(64, 64, { r: 64, g: 64, b: 64 });

    vi.doMock("child_process", () => ({
      execFile: vi.fn((_bin: string, _args: string[], _opts: unknown, callback: (error: Error | null, stdout: Buffer, stderr: Buffer) => void) => {
        callback(null, decoded, Buffer.alloc(0));
      }),
    }));
    vi.doMock("exifr", () => ({
      default: {
        parse: mockParse.mockResolvedValue({ BaselineExposure: 2 }),
      },
    }));

    const { processRawWithDcraw } = await import("@/features/media/processing");
    const result = await processRawWithDcraw(Buffer.from("raw"), "IMG_3006.dng");
    const stats = await sharp(result.buffer).stats();

    expect(mockParse).toHaveBeenCalled();
    expect(stats.channels[0].mean).toBeGreaterThan(200);
    expect(stats.channels[1].mean).toBeGreaterThan(200);
    expect(stats.channels[2].mean).toBeGreaterThan(200);
  });
});
