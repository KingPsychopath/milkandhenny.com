import { useEffect, useMemo, useRef } from "react";

import type { PitchAsset, PitchMediaClip, PitchSlide } from "../types";

function assetUrl(clip: PitchMediaClip, assets: PitchAsset[]): string | undefined {
  return assets.find((asset) => asset.id === clip.assetId && asset.state === "ready")?.url;
}

export function usePitchMediaPlayback({
  slide,
  assets,
  playheadMs,
  playing,
  soundEnabled,
}: {
  slide?: PitchSlide;
  assets: PitchAsset[];
  playheadMs: number;
  playing: boolean;
  soundEnabled: boolean;
}) {
  const sounds = useRef(new Map<string, HTMLAudioElement>());
  useEffect(() => {
    const activeIds = new Set(
      slide?.mediaClips.filter((clip) => clip.kind === "audio").map((clip) => clip.id),
    );
    for (const [id, audio] of sounds.current) {
      if (activeIds.has(id)) continue;
      audio.pause();
      audio.removeAttribute("src");
      sounds.current.delete(id);
    }
  }, [slide?.mediaClips]);

  useEffect(() => {
    if (!slide) return;
    for (const clip of slide.mediaClips.filter((candidate) => candidate.kind === "audio")) {
      const start = clip.timelineStartMs;
      const end = start + clip.durationMs;
      const active = playheadMs >= start && playheadMs < end;
      let audio = sounds.current.get(clip.id);
      const url = assetUrl(clip, assets);
      if (!audio && url) {
        audio = new Audio(url);
        audio.preload = "auto";
        sounds.current.set(clip.id, audio);
      }
      if (!audio) continue;
      audio.volume = Math.max(0, Math.min(1, clip.volume));
      audio.muted = clip.muted || !soundEnabled;
      if (!active || !playing) {
        audio.pause();
        continue;
      }
      const wantedSeconds = (clip.sourceStartMs + playheadMs - start) / 1_000;
      if (Math.abs(audio.currentTime - wantedSeconds) > 0.2) {
        try {
          audio.currentTime = wantedSeconds;
        } catch {
          // Metadata loading will catch up on the next clock update.
        }
      }
      if (audio.paused) void audio.play().catch(() => undefined);
    }
  }, [assets, playheadMs, playing, slide, soundEnabled]);

  useEffect(
    () => () => {
      for (const audio of sounds.current.values()) {
        audio.pause();
        audio.removeAttribute("src");
      }
      sounds.current.clear();
    },
    [],
  );
}

export function PitchVideoLayer({
  slide,
  assets,
  playheadMs,
  playing,
}: {
  slide?: PitchSlide;
  assets: PitchAsset[];
  playheadMs: number;
  playing: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const clip = useMemo(
    () =>
      (slide?.mediaClips ?? [])
        .toReversed()
        .find(
          (candidate) =>
            candidate.kind === "video" &&
            playheadMs >= candidate.timelineStartMs &&
            playheadMs < candidate.timelineStartMs + candidate.durationMs,
        ),
    [playheadMs, slide?.mediaClips],
  );
  const url = clip ? assetUrl(clip, assets) : undefined;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip || !url) return;
    const wantedSeconds = (clip.sourceStartMs + playheadMs - clip.timelineStartMs) / 1_000;
    if (Math.abs(video.currentTime - wantedSeconds) > 0.2) {
      try {
        video.currentTime = wantedSeconds;
      } catch {
        // Metadata loading will catch up on the next clock update.
      }
    }
    if (playing && video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, [clip, playheadMs, playing, url]);

  if (!clip || !url) return null;
  return (
    <div
      className="pointer-events-none h-full w-full overflow-hidden bg-foreground"
      aria-hidden="true"
    >
      <video
        ref={videoRef}
        key={`${clip.id}:${url}`}
        src={url}
        muted
        playsInline
        preload="auto"
        className={`h-full w-full ${clip.fit === "cover" ? "object-cover" : "object-contain"}`}
      />
    </div>
  );
}
