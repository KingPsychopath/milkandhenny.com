import {
  PITCH_AUDIO_MAX_BYTES,
  PITCH_MEDIA_INPUT_MAX_BYTES,
  PITCH_MEDIA_MAX_SECONDS,
  PITCH_VIDEO_MAX_BYTES,
  type PitchMediaKind,
} from "./types";

export interface PreparedPitchMedia {
  file: File;
  kind: PitchMediaKind;
  durationMs: number;
  hasAudio: boolean;
  width?: number;
  height?: number;
  sourceBytes: number;
  optimizedBytes: number;
}

export class PitchMediaNeedsTrimError extends Error {
  constructor(
    readonly durationMs: number,
    readonly kind: PitchMediaKind,
  ) {
    super("Choose the part of this media file to use");
    this.name = "PitchMediaNeedsTrimError";
  }
}

function outputName(fileName: string, kind: PitchMediaKind): string {
  const stem = fileName.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-") || kind;
  return `${stem}.${kind === "video" ? "mp4" : "m4a"}`;
}

function mediaError(error: unknown): Error {
  if (error instanceof PitchMediaNeedsTrimError) return error;
  const detail = error instanceof Error ? error.message : "";
  if (detail.includes("codec") || detail.includes("encode") || detail.includes("decode")) {
    return new Error(
      "This browser cannot convert that media format. Try MP4 for video or MP3, M4A or WAV for sound.",
    );
  }
  return new Error(detail || "That media file could not be prepared");
}

export async function preparePitchMedia(
  sourceFile: File,
  onProgress?: (progress: number) => void,
  selection?: { startMs: number; durationMs: number },
): Promise<PreparedPitchMedia> {
  if (sourceFile.size < 1 || sourceFile.size > PITCH_MEDIA_INPUT_MAX_BYTES) {
    throw new Error("Choose a media file under 250 MB");
  }

  const {
    ALL_FORMATS,
    BlobSource,
    BufferTarget,
    Conversion,
    Input,
    Mp4OutputFormat,
    Output,
    Quality,
  } = await import("mediabunny");
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(sourceFile, { maxCacheSize: 8 * 1024 * 1024 }),
  });

  try {
    if (!(await input.canRead())) throw new Error("That media format could not be read");
    const [durationSeconds, videoTrack, audioTrack] = await Promise.all([
      input.computeDuration(),
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ]);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error("That media file has no usable duration");
    }
    const kind: PitchMediaKind = videoTrack ? "video" : "audio";
    const sourceDurationMs = Math.round(durationSeconds * 1_000);
    if (durationSeconds > PITCH_MEDIA_MAX_SECONDS && !selection) {
      throw new PitchMediaNeedsTrimError(sourceDurationMs, kind);
    }
    const selectedStartMs = selection?.startMs ?? 0;
    const selectedDurationMs = selection?.durationMs ?? sourceDurationMs;
    if (
      !Number.isInteger(selectedStartMs) ||
      !Number.isInteger(selectedDurationMs) ||
      selectedStartMs < 0 ||
      selectedDurationMs < 500 ||
      selectedDurationMs > PITCH_MEDIA_MAX_SECONDS * 1_000 ||
      selectedStartMs + selectedDurationMs > sourceDurationMs
    ) {
      throw new Error("That media selection is outside the source file");
    }
    if (!videoTrack && !audioTrack) throw new Error("That file contains no usable video or sound");

    const [
      width,
      height,
      videoCodec,
      audioCodec,
      channels,
      sampleRate,
      videoFirstTimestamp,
      audioFirstTimestamp,
    ] = await Promise.all([
      videoTrack?.getDisplayWidth(),
      videoTrack?.getDisplayHeight(),
      videoTrack?.getCodec(),
      audioTrack?.getCodec(),
      audioTrack?.getNumberOfChannels(),
      audioTrack?.getSampleRate(),
      videoTrack?.getFirstTimestamp(),
      audioTrack?.getFirstTimestamp(),
    ]);
    const naturalStart = Math.min(0, videoFirstTimestamp ?? 0, audioFirstTimestamp ?? 0);
    const outputTarget = new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target: outputTarget,
    });
    const shouldResize = Boolean(height && height > 720);
    const shouldTranscodeVideo = Boolean(
      videoTrack &&
      (videoCodec !== "avc" || shouldResize || sourceFile.size > PITCH_VIDEO_MAX_BYTES),
    );
    const shouldTranscodeAudio = Boolean(
      audioTrack &&
      (audioCodec !== "aac" ||
        (channels ?? 2) > 2 ||
        (sampleRate ?? 48_000) > 48_000 ||
        (!videoTrack && sourceFile.size > PITCH_AUDIO_MAX_BYTES)),
    );
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      video: videoTrack
        ? {
            codec: "avc",
            height: shouldResize ? 720 : undefined,
            ...(shouldTranscodeVideo
              ? {
                  quality: new Quality({ bitrate: 2_500_000, bitrateMode: "variable" }),
                  keyFrameInterval: 2,
                }
              : {}),
            forceTranscode: shouldTranscodeVideo,
            hardwareAcceleration: "prefer-hardware",
          }
        : { discard: true },
      audio: audioTrack
        ? {
            codec: "aac",
            numberOfChannels: Math.min(2, channels ?? 2),
            sampleRate: Math.min(48_000, sampleRate ?? 48_000),
            ...(shouldTranscodeAudio
              ? { quality: new Quality({ bitrate: 128_000, bitrateMode: "variable" }) }
              : {}),
            forceTranscode: shouldTranscodeAudio,
          }
        : { discard: true },
      ...(selection
        ? {
            trim: {
              start: selectedStartMs / 1_000,
              end: (selectedStartMs + selectedDurationMs) / 1_000,
            },
          }
        : naturalStart < 0
          ? { trim: { start: naturalStart } }
          : {}),
      tags: {},
      showWarnings: false,
    });
    if (!conversion.isValid) {
      throw new Error(
        conversion.discardedTracks[0]?.reason === "no_encodable_target_codec"
          ? "This browser cannot encode a web-ready version of that file"
          : "That file contains an unsupported media track",
      );
    }
    conversion.onProgress = (progress) => onProgress?.(Math.max(0, Math.min(1, progress)));
    await conversion.execute();
    const buffer = outputTarget.buffer;
    if (!buffer) throw new Error("The optimized media file was empty");
    const mimeType = kind === "video" ? "video/mp4" : "audio/mp4";
    const optimized = new File([buffer], outputName(sourceFile.name, kind), { type: mimeType });
    const maximumBytes = kind === "video" ? PITCH_VIDEO_MAX_BYTES : PITCH_AUDIO_MAX_BYTES;
    if (optimized.size > maximumBytes) {
      throw new Error(
        kind === "video"
          ? "The optimized video is still over 60 MB. Shorten it or use a smaller source."
          : "The optimized sound is still over 15 MB. Shorten it or use a smaller source.",
      );
    }
    onProgress?.(1);
    return {
      file: optimized,
      kind,
      durationMs: selectedDurationMs,
      hasAudio: Boolean(audioTrack),
      width,
      height,
      sourceBytes: sourceFile.size,
      optimizedBytes: optimized.size,
    };
  } catch (error) {
    throw mediaError(error);
  } finally {
    input.dispose();
  }
}
