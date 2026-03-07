import { execFile } from "child_process";
import { mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { processVideoVariants } from "@/features/media/processing";

const execFileAsync = promisify(execFile);

async function makeVideoBuffer(): Promise<Buffer> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "video-preview-test-"));
  const outputPath = path.join(tempDir, "fixture.mp4");

  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-f", "lavfi",
      "-i", "color=c=#336699:s=160x90:d=1",
      "-pix_fmt", "yuv420p",
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
