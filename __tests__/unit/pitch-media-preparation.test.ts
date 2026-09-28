import { beforeEach, describe, expect, it, vi } from "vitest";
import { preparePitchMedia } from "../../features/things/pitches/media.client";

const state = vi.hoisted(() => ({
  sizes: [100],
  options: [] as Array<Record<string, unknown>>,
  disposed: vi.fn(),
  discarded: [] as Array<{ reason: string }>,
  fail: false,
}));
vi.mock("mediabunny", () => {
  const track = {
    getDisplayWidth: async () => 1280,
    getDisplayHeight: async () => 720,
    getCodec: async () => "avc",
    getFirstTimestamp: async () => 0,
  };
  return {
    ALL_FORMATS: [],
    BlobSource: vi.fn(),
    BufferTarget: class {
      buffer?: ArrayBuffer;
    },
    Mp4OutputFormat: vi.fn(),
    Quality: vi.fn(),
    Input: class {
      canRead = async () => true;
      computeDuration = async () => 120;
      getPrimaryVideoTrack = async () => track;
      getPrimaryAudioTrack = async () => null;
      dispose = state.disposed;
    },
    Output: class {
      target: { buffer?: ArrayBuffer };
      constructor(options: { target: { buffer?: ArrayBuffer } }) {
        this.target = options.target;
      }
    },
    Conversion: {
      init: async (options: { output: { target: { buffer?: ArrayBuffer } } }) => {
        state.options.push(options);
        return {
          isValid: true,
          discardedTracks: state.discarded,
          onProgress: (_progress: number) => {},
          async execute() {
            if (state.fail) throw new Error("Conversion failed");
            this.onProgress(1);
            options.output.target.buffer = new ArrayBuffer(state.sizes.shift() ?? 100);
          },
        };
      },
    },
  };
});

const selection = { startMs: 1370, durationMs: 2200 };
function source() {
  const file = new File(["video"], "large.mp4", { type: "video/mp4" });
  Object.defineProperty(file, "size", { value: 100 * 1024 * 1024 });
  return file;
}

describe("pitch media preparation", () => {
  beforeEach(() => {
    state.sizes = [100];
    state.options = [];
    state.discarded = [];
    state.fail = false;
    state.disposed.mockClear();
  });

  it("should preserve a small selection from a large source without forced compression", async () => {
    const result = await preparePitchMedia(source(), undefined, selection);
    expect(result.file.size).toBe(100);
    expect(result.durationMs).toBe(2200);
    expect(state.options).toHaveLength(1);
    expect(state.options[0]).toMatchObject({
      video: { forceTranscode: false },
      trim: { start: 1.37, end: 3.57 },
      copy: { mode: "preferred", shiftTolerance: 0 },
    });
    expect(state.disposed).toHaveBeenCalledOnce();
  });

  it("should compress an oversized result once and keep progress monotonic", async () => {
    state.sizes = [61 * 1024 * 1024, 100];
    const progress: number[] = [];
    const result = await preparePitchMedia(source(), (value) => progress.push(value), selection);
    expect(result.file.size).toBe(100);
    expect(state.options).toHaveLength(2);
    expect(state.options[1]).toMatchObject({ video: { forceTranscode: true } });
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(1);
  });

  it("should reject a result that remains oversized after compression", async () => {
    state.sizes = [61 * 1024 * 1024, 61 * 1024 * 1024];
    await expect(preparePitchMedia(source(), undefined, selection)).rejects.toThrow(
      "still over 60 MB",
    );
    expect(state.options).toHaveLength(2);
    expect(state.disposed).toHaveBeenCalledOnce();
  });

  it("should reject a discarded required track instead of silently losing it", async () => {
    state.discarded = [{ reason: "no_encodable_target_codec" }];
    await expect(preparePitchMedia(source(), undefined, selection)).rejects.toThrow(
      "cannot convert",
    );
    expect(state.options).toHaveLength(1);
    expect(state.disposed).toHaveBeenCalledOnce();
  });

  it("should release the source without retrying a conversion failure", async () => {
    state.fail = true;
    await expect(preparePitchMedia(source(), undefined, selection)).rejects.toThrow(
      "Conversion failed",
    );
    expect(state.options).toHaveLength(1);
    expect(state.disposed).toHaveBeenCalledOnce();
  });
});
