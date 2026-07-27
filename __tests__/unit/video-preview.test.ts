import { execFile } from "child_process";
import { mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { processVideoVariants } from "@/features/media/processing.server";

const execFileAsync = promisify(execFile);

async function makeVideoFile(extraArgs: string[] = []): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "video-meta-test-"));
  const outputPath = path.join(tempDir, "fixture.mov");
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=#336699:s=160x90:d=0.4",
    "-pix_fmt",
    "yuv420p",
    // Without this the mov muxer silently drops any tag it does not recognise,
    // including every com.apple.quicktime.* key we care about.
    "-movflags",
    "use_metadata_tags",
    ...extraArgs,
    outputPath,
  ]);
  return outputPath;
}

async function makeVideoBuffer(): Promise<Buffer> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "video-preview-test-"));
  const outputPath = path.join(tempDir, "fixture.mp4");

  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=#336699:s=160x90:d=1",
      "-pix_fmt",
      "yuv420p",
      outputPath,
    ]);

    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

describe("video preview processing", () => {
  it("creates thumb and poster variants from a video file", async () => {
    const video = await makeVideoBuffer();

    const result = await processVideoVariants(video, ".mp4");
    const thumbMeta = await sharp(result.thumb.buffer).metadata();
    const fullMeta = await sharp(result.full.buffer).metadata();

    expect(result.thumb.contentType).toBe("image/webp");
    expect(result.full.contentType).toBe("image/webp");
    expect(result.width).toBe(160);
    expect(result.height).toBe(90);
    expect(result.durationSeconds).not.toBeNull();
    expect(thumbMeta.format).toBe("webp");
    expect(fullMeta.format).toBe("webp");
  });
});

describe("poster frame timestamp", () => {
  it("stays inside a Live Photo motion clip", async () => {
    const { getVideoCaptureTimestamp } = await import("@/features/media/processing.server");

    // iPhone Live Photo clips run about a third of a second. Seeking to a
    // fixed 0.5s — as this once did — lands past the end and ffmpeg returns
    // no frame, which is how every sub-second video silently lost its poster.
    expect(Number(getVideoCaptureTimestamp(0.333))).toBeLessThan(0.333);
    expect(Number(getVideoCaptureTimestamp(0.6))).toBeLessThan(0.6);
    expect(Number(getVideoCaptureTimestamp(0.9))).toBeLessThan(0.9);
  });

  it("never seeks past the midpoint", async () => {
    const { getVideoCaptureTimestamp } = await import("@/features/media/processing.server");

    for (const duration of [0.3, 0.5, 1, 2, 10, 600]) {
      expect(Number(getVideoCaptureTimestamp(duration))).toBeLessThanOrEqual(duration / 2);
    }
  });

  it("skips the opening frame on anything long enough to have one", async () => {
    const { getVideoCaptureTimestamp } = await import("@/features/media/processing.server");

    expect(Number(getVideoCaptureTimestamp(10))).toBeGreaterThan(0);
    expect(Number(getVideoCaptureTimestamp(600))).toBeGreaterThan(0);
  });

  it("falls back to the first frame when duration is unknown or trivial", async () => {
    const { getVideoCaptureTimestamp } = await import("@/features/media/processing.server");

    expect(getVideoCaptureTimestamp(null)).toBe("0");
    expect(getVideoCaptureTimestamp(0.1)).toBe("0");
    expect(getVideoCaptureTimestamp(Number.NaN)).toBe("0");
  });
});

describe("video capture metadata", () => {
  it("reads Apple's capture date as wall clock, matching how stills are read", async () => {
    const { processVideoVariantsFromFile } = await import("@/features/media/processing.server");
    const file = await makeVideoFile([
      "-metadata",
      "com.apple.quicktime.creationdate=2026-07-26T20:37:45+0100",
    ]);

    try {
      const result = await processVideoVariantsFromFile(file);
      // EXIF gives stills no timezone and exif-reader reads them as UTC, so a
      // photo taken at 20:37 local is stored as 20:37Z. Honouring the video's
      // +0100 here would drop the clip an hour away from the photo taken
      // beside it and scatter a gallery sorted by capture time.
      expect(result.takenAt).toBe("2026-07-26T20:37:45.000Z");
    } finally {
      await rm(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("picks up the Live Photo content identifier when the clip carries one", async () => {
    const { processVideoVariantsFromFile } = await import("@/features/media/processing.server");
    const file = await makeVideoFile([
      "-metadata",
      "com.apple.quicktime.content.identifier=ABC-123",
    ]);

    try {
      const result = await processVideoVariantsFromFile(file);
      expect(result.livePhotoContentId).toBe("ABC-123");
    } finally {
      await rm(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("still produces a poster for a sub-second motion clip", async () => {
    const { processVideoVariantsFromFile } = await import("@/features/media/processing.server");
    const file = await makeVideoFile();

    try {
      const result = await processVideoVariantsFromFile(file);
      expect(result.durationSeconds).toBeLessThan(1);
      expect(result.thumb.buffer.byteLength).toBeGreaterThan(0);
      expect(result.full.buffer.byteLength).toBeGreaterThan(0);
    } finally {
      await rm(path.dirname(file), { recursive: true, force: true });
    }
  });
});
