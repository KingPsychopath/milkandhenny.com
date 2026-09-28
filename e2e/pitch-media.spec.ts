import { Input, BlobSource, ALL_FORMATS, EncodedPacketSink } from "mediabunny";
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fixture: string;
let directory: string;
test.beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "pitch-media-"));
  const path = join(directory, "source.mp4");
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "5",
    "-c:v",
    "libx264",
    "-g",
    "90",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    path,
  ]);
  fixture = readFileSync(path).toString("base64");
});
test.afterAll(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test("copies a large source between keyframes without encoders and retains playable audio/video", async ({
  page,
}) => {
  await page.goto("/things/pitches/new");
  const result = await page.evaluate(async (encoded) => {
    const modulePath = "/features/things/pitches/media.client.ts";
    const { preparePitchMedia } = await import(/* @vite-ignore */ modulePath);
    // A large container with a small selected clip must not force compression.
    const source = new File(
      [Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)), new Uint8Array(61 * 1024 * 1024)],
      "large.mp4",
      { type: "video/mp4" },
    );
    Object.defineProperty(window, "VideoEncoder", { value: undefined, configurable: true });
    Object.defineProperty(window, "AudioEncoder", { value: undefined, configurable: true });
    const prepared = await preparePitchMedia(source, undefined, {
      startMs: 1370,
      durationMs: 2200,
    });
    const url = URL.createObjectURL(prepared.file);
    const video = document.createElement("video");
    video.muted = true;
    document.body.appendChild(video);
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("Trimmed MP4 could not be loaded"));
        video.src = url;
      });
      const duration = video.duration;
      video.currentTime = 1;
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
      });
      await video.play();
      return {
        duration,
        width: video.videoWidth,
        height: video.videoHeight,
        hasAudio: prepared.hasAudio,
        selectedDurationMs: prepared.durationMs,
        output: Array.from(new Uint8Array(await prepared.file.arrayBuffer())),
        bytes: prepared.file.size,
        sourceBytes: source.size,
      };
    } finally {
      video.pause();
      video.remove();
      URL.revokeObjectURL(url);
    }
  }, fixture);
  expect(result.sourceBytes).toBeGreaterThan(60 * 1024 * 1024);
  expect(result.bytes).toBeLessThan(1024 * 1024);
  expect(result.selectedDurationMs).toBe(2200);
  // Copying includes dependent B-frames after the end; the pitch timeline uses
  // the selected duration above, not the expanded container duration.
  expect(result.duration).toBeGreaterThanOrEqual(2.2);
  expect(result.duration).toBeLessThan(2.4);
  const original = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(new Blob([Buffer.from(fixture, "base64")])),
  });
  const copied = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(new Blob([new Uint8Array(result.output)])),
  });
  try {
    for (const kind of ["video", "audio"] as const) {
      const originalTrack =
        kind === "video"
          ? await original.getPrimaryVideoTrack()
          : await original.getPrimaryAudioTrack();
      const copiedTrack =
        kind === "video"
          ? await copied.getPrimaryVideoTrack()
          : await copied.getPrimaryAudioTrack();
      if (!originalTrack || !copiedTrack) throw new Error(`Missing ${kind} track`);
      const packets = new Map<string, number>();
      for await (const packet of new EncodedPacketSink(originalTrack).packets()) {
        packets.set(Buffer.from(packet.data).toString("base64"), packet.timestamp);
      }
      let count = 0;
      for await (const packet of new EncodedPacketSink(copiedTrack).packets()) {
        const originalTimestamp = packets.get(Buffer.from(packet.data).toString("base64"));
        expect(originalTimestamp).toBeDefined();
        expect(packet.timestamp).toBeCloseTo(originalTimestamp! - 1.37, 4);
        count++;
      }
      expect(count).toBeGreaterThan(1);
    }
  } finally {
    original.dispose();
    copied.dispose();
  }
  expect(result.width).toBe(320);
  expect(result.height).toBe(180);
  expect(result.hasAudio).toBe(true);
});
