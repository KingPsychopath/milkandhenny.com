import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

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

describe("raw decoder resolution", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("falls back to dcraw when dcraw_emu is missing", async () => {
    const decoded = await makeJpegBuffer(64, 64, { r: 120, g: 110, b: 100 });
    const execFile = vi.fn(
      (bin: string, _args: string[], _opts: unknown, callback: (error: Error | null, stdout: Buffer, stderr: Buffer) => void) => {
        if (bin === "dcraw_emu") {
          const error = new Error("spawn dcraw_emu ENOENT");
          Object.assign(error, { code: "ENOENT" });
          callback(error, Buffer.alloc(0), Buffer.alloc(0));
          return;
        }
        callback(null, decoded, Buffer.alloc(0));
      }
    );

    vi.doMock("child_process", () => ({ execFile }));

    const { processRawWithDcraw } = await import("@/features/media/processing");
    const result = await processRawWithDcraw(Buffer.from("raw"), "IMG_3006.dng");

    expect(result.width).toBe(64);
    expect(result.height).toBe(64);
    expect(execFile).toHaveBeenCalledTimes(2);
    expect(execFile).toHaveBeenNthCalledWith(
      1,
      "dcraw_emu",
      expect.any(Array),
      expect.any(Object),
      expect.any(Function)
    );
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      "dcraw",
      expect.any(Array),
      expect.any(Object),
      expect.any(Function)
    );
  });

  it("does not mask a real dcraw_emu failure with dcraw ENOENT", async () => {
    const execFile = vi.fn(
      (bin: string, _args: string[], _opts: unknown, callback: (error: Error | null, stdout: Buffer, stderr: Buffer) => void) => {
        if (bin === "dcraw_emu") {
          callback(new Error("decoder exploded"), Buffer.alloc(0), Buffer.from("bad raw"));
          return;
        }
        const error = new Error("spawn dcraw ENOENT");
        Object.assign(error, { code: "ENOENT" });
        callback(error, Buffer.alloc(0), Buffer.alloc(0));
      }
    );

    vi.doMock("child_process", () => ({ execFile }));

    const { processRawWithDcraw } = await import("@/features/media/processing");

    await expect(processRawWithDcraw(Buffer.from("raw"), "IMG_3006.dng")).rejects.toThrow(
      "dcraw_emu failed: decoder exploded"
    );
    expect(execFile).toHaveBeenCalledTimes(2);
  });
});
