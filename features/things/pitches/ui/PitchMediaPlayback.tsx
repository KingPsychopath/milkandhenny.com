import { useEffect, useMemo, useRef, useState } from "react";

import {
  PITCH_SLIDE_STAGE,
  PITCH_VIDEO_DEFAULT_PLACEMENT,
  type PitchAsset,
  type PitchMediaClip,
  type PitchSlide,
  type PitchVideoClip,
  type PitchVideoPlacement,
} from "../types";

function assetUrl(clip: PitchMediaClip, assets: PitchAsset[]): string | undefined {
  return assets.find(
    (asset) =>
      asset.id === clip.assetId && asset.state === "ready" && asset.availability === "available",
  )?.url;
}

function sourceTimeMs(clip: PitchMediaClip, playheadMs: number): number {
  const elapsedMs = Math.max(0, playheadMs - clip.timelineStartMs);
  const sourceRemainingMs = Math.max(1, clip.sourceDurationMs - clip.sourceStartMs);
  return clip.sourceStartMs + (clip.loop ? elapsedMs % sourceRemainingMs : elapsedMs);
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
      const wantedSeconds = sourceTimeMs(clip, playheadMs) / 1_000;
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
  const clips = useMemo(
    () =>
      (slide?.mediaClips ?? [])
        .filter(
          (candidate): candidate is PitchVideoClip =>
            candidate.kind === "video" &&
            playheadMs >= candidate.timelineStartMs &&
            playheadMs < candidate.timelineStartMs + candidate.durationMs,
        )
        .toSorted(
          (left, right) => (left.videoPlacement?.layer ?? 0) - (right.videoPlacement?.layer ?? 0),
        ),
    [playheadMs, slide?.mediaClips],
  );
  if (clips.length === 0) return null;
  return (
    <div className="pointer-events-none relative h-full w-full overflow-hidden" aria-hidden="true">
      {clips.map((clip) => {
        const asset = assets.find((candidate) => candidate.id === clip.assetId);
        const url = assetUrl(clip, assets);
        return url ? (
          <PitchVideoPlaybackClip
            key={clip.id}
            clip={clip}
            url={url}
            fileName={asset?.fileName ?? "video file"}
            playheadMs={playheadMs}
            playing={playing}
            transferState={asset?.transferState ?? "error"}
          />
        ) : (
          <PitchUnavailableVideo
            key={clip.id}
            clip={clip}
            fileName={asset?.fileName ?? "video file"}
          />
        );
      })}
    </div>
  );
}

function placementFor(clip: PitchVideoClip): PitchVideoPlacement {
  return clip.videoPlacement;
}

function placementStyle(placement: PitchVideoPlacement): React.CSSProperties {
  return {
    left: `${(placement.x / PITCH_SLIDE_STAGE.width) * 100}%`,
    top: `${(placement.y / PITCH_SLIDE_STAGE.height) * 100}%`,
    width: `${(placement.width / PITCH_SLIDE_STAGE.width) * 100}%`,
    height: `${(placement.height / PITCH_SLIDE_STAGE.height) * 100}%`,
    zIndex: placement.layer,
  };
}

function PitchVideoPlaybackClip({
  clip,
  url,
  fileName,
  playheadMs,
  playing,
  transferState,
}: {
  clip: PitchVideoClip;
  url: string;
  fileName: string;
  playheadMs: number;
  playing: boolean;
  transferState: PitchAsset["transferState"];
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const wantedSeconds = sourceTimeMs(clip, playheadMs) / 1_000;
    if (Math.abs(video.currentTime - wantedSeconds) > 0.2) {
      try {
        video.currentTime = wantedSeconds;
      } catch {
        // Metadata loading will catch up on the next clock update.
      }
    }
    if (playing && video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, [clip, playheadMs, playing]);

  if (failed) return <PitchUnavailableVideo clip={clip} fileName={fileName} />;
  return (
    <div
      className={`absolute overflow-hidden bg-foreground ${
        transferState === "secured"
          ? ""
          : transferState === "uploading"
            ? "ring-2 ring-inset ring-[var(--things-amber)]"
            : "border border-dashed border-[var(--things-amber)]"
      }`}
      style={placementStyle(placementFor(clip))}
    >
      <video
        ref={videoRef}
        src={url}
        muted
        playsInline
        preload="auto"
        className={`h-full w-full ${clip.fit === "cover" ? "object-cover" : "object-contain"}`}
        onError={() => setFailed(true)}
      />
      {transferState !== "secured" ? (
        <span
          className={`absolute right-2 top-2 bg-background/90 px-2 py-1 font-mono text-micro text-foreground shadow-sm ${
            transferState === "uploading" ? "motion-safe:animate-pulse" : ""
          }`}
        >
          {transferState === "uploading"
            ? "securing…"
            : transferState === "local"
              ? "safe on device"
              : "retry needed"}
        </span>
      ) : null}
    </div>
  );
}

function PitchUnavailableVideo({ clip, fileName }: { clip: PitchVideoClip; fileName: string }) {
  return (
    <div
      className="absolute flex items-center justify-center overflow-hidden border border-dashed border-[var(--things-amber)] bg-surface px-4 text-center"
      style={placementStyle(placementFor(clip))}
    >
      <div>
        <p className="font-mono text-xs font-semibold text-foreground">video unavailable</p>
        <p className="mt-1 max-w-full truncate font-mono text-micro theme-muted">{fileName}</p>
      </div>
    </div>
  );
}

type PlacementGesture = {
  pointerId: number;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  stageWidth: number;
  stageHeight: number;
  placement: PitchVideoPlacement;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function PitchVideoControl({
  clip,
  selected,
  atBack,
  atFront,
  onSelect,
  onChange,
  onReorder,
}: {
  clip: PitchVideoClip;
  selected: boolean;
  atBack: boolean;
  atFront: boolean;
  onSelect: () => void;
  onChange: (update: (clip: PitchVideoClip) => PitchVideoClip) => void;
  onReorder: (direction: "backward" | "forward") => void;
}) {
  const savedPlacement = placementFor(clip);
  const [draftPlacement, setDraftPlacement] = useState<PitchVideoPlacement>();
  const [gesture, setGesture] = useState<PlacementGesture>();
  const placement = draftPlacement ?? savedPlacement;

  const begin = (
    event: React.PointerEvent<HTMLDivElement | HTMLButtonElement>,
    mode: PlacementGesture["mode"],
  ) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    if (clip.locked) return;
    const stage = event.currentTarget.closest("[data-pitch-video-stage]")?.getBoundingClientRect();
    if (!stage) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      stageWidth: stage.width,
      stageHeight: stage.height,
      placement: savedPlacement,
    });
    setDraftPlacement(savedPlacement);
  };

  const move = (event: React.PointerEvent<HTMLElement>) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const deltaX =
      ((event.clientX - gesture.startX) / gesture.stageWidth) * PITCH_SLIDE_STAGE.width;
    const deltaY =
      ((event.clientY - gesture.startY) / gesture.stageHeight) * PITCH_SLIDE_STAGE.height;
    if (gesture.mode === "move") {
      setDraftPlacement({
        ...gesture.placement,
        x: Math.round(
          clamp(gesture.placement.x + deltaX, 0, PITCH_SLIDE_STAGE.width - gesture.placement.width),
        ),
        y: Math.round(
          clamp(
            gesture.placement.y + deltaY,
            0,
            PITCH_SLIDE_STAGE.height - gesture.placement.height,
          ),
        ),
      });
      return;
    }
    setDraftPlacement({
      ...gesture.placement,
      width: Math.round(
        clamp(gesture.placement.width + deltaX, 40, PITCH_SLIDE_STAGE.width - gesture.placement.x),
      ),
      height: Math.round(
        clamp(
          gesture.placement.height + deltaY,
          40,
          PITCH_SLIDE_STAGE.height - gesture.placement.y,
        ),
      ),
    });
  };

  const finish = () => {
    if (draftPlacement && gesture) {
      const committed = draftPlacement;
      onChange((current) => ({ ...current, videoPlacement: committed }));
    }
    setGesture(undefined);
    setDraftPlacement(undefined);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${selected ? "Selected " : ""}video on slide. Drag to move.`}
      className={`pointer-events-auto absolute touch-none border-2 ${
        selected
          ? "border-[var(--things-amber)]"
          : "border-transparent hover:border-[var(--things-amber)]/60"
      } ${clip.locked ? "cursor-not-allowed" : "cursor-move"}`}
      style={placementStyle(placement)}
      onPointerDown={(event) => begin(event, "move")}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onKeyDown={(event) => {
        if (
          clip.locked ||
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
        ) {
          return;
        }
        event.preventDefault();
        const amount = event.shiftKey ? 20 : 5;
        onChange((current) => {
          const currentPlacement = placementFor(current);
          return {
            ...current,
            videoPlacement: {
              ...currentPlacement,
              x: clamp(
                currentPlacement.x +
                  (event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0),
                0,
                PITCH_SLIDE_STAGE.width - currentPlacement.width,
              ),
              y: clamp(
                currentPlacement.y +
                  (event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0),
                0,
                PITCH_SLIDE_STAGE.height - currentPlacement.height,
              ),
            },
          };
        });
      }}
    >
      {selected ? (
        <>
          <div className="absolute left-1 top-1 flex max-w-[calc(100%-0.5rem)] flex-wrap gap-1 bg-background/95 p-1 font-mono text-micro text-foreground shadow-sm">
            <button
              type="button"
              disabled={clip.locked}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onChange((current) => ({
                  ...current,
                  videoPlacement: {
                    ...PITCH_VIDEO_DEFAULT_PLACEMENT,
                    layer: placementFor(current).layer,
                  },
                }));
              }}
              className="min-h-8 px-2 hover:opacity-60 disabled:opacity-35"
            >
              centre
            </button>
            <button
              type="button"
              disabled={clip.locked}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onChange((current) => ({
                  ...current,
                  videoPlacement: {
                    x: 0,
                    y: 0,
                    width: PITCH_SLIDE_STAGE.width,
                    height: PITCH_SLIDE_STAGE.height,
                    layer: placementFor(current).layer,
                  },
                }));
              }}
              className="min-h-8 px-2 hover:opacity-60 disabled:opacity-35"
            >
              full slide
            </button>
            <button
              type="button"
              disabled={clip.locked}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onChange((current) => ({
                  ...current,
                  fit: current.fit === "cover" ? "contain" : "cover",
                }));
              }}
              className="min-h-8 px-2 hover:opacity-60 disabled:opacity-35"
            >
              {clip.fit === "cover" ? "show whole" : "fill frame"}
            </button>
            <button
              type="button"
              disabled={clip.locked || atBack}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onReorder("backward");
              }}
              className="min-h-8 px-2 hover:opacity-60 disabled:opacity-35"
            >
              backward
            </button>
            <button
              type="button"
              disabled={clip.locked || atFront}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onReorder("forward");
              }}
              className="min-h-8 px-2 hover:opacity-60 disabled:opacity-35"
            >
              forward
            </button>
          </div>
          <button
            type="button"
            disabled={clip.locked}
            aria-label="Resize video"
            className="absolute -bottom-3 -right-3 h-7 w-7 cursor-nwse-resize border-2 border-[var(--things-amber)] bg-background disabled:cursor-not-allowed"
            onPointerDown={(event) => begin(event, "resize")}
            onPointerMove={(event) => {
              event.stopPropagation();
              move(event);
            }}
            onPointerUp={(event) => {
              event.stopPropagation();
              finish();
            }}
            onPointerCancel={(event) => {
              event.stopPropagation();
              finish();
            }}
          />
        </>
      ) : null}
    </div>
  );
}

export function PitchVideoStageControls({
  slide,
  playheadMs,
  selectedClipId,
  onSelectClip,
  onChange,
  onReorder,
}: {
  slide: PitchSlide;
  playheadMs: number;
  selectedClipId?: string;
  onSelectClip: (clipId: string) => void;
  onChange: (clipId: string, update: (clip: PitchVideoClip) => PitchVideoClip) => void;
  onReorder: (clipId: string, direction: "backward" | "forward") => void;
}) {
  const clips = slide.mediaClips
    .filter(
      (clip): clip is PitchVideoClip =>
        clip.kind === "video" &&
        playheadMs >= clip.timelineStartMs &&
        playheadMs < clip.timelineStartMs + clip.durationMs,
    )
    .toSorted(
      (left, right) => (left.videoPlacement?.layer ?? 0) - (right.videoPlacement?.layer ?? 0),
    );
  return (
    <div data-pitch-video-stage className="relative h-full w-full">
      {clips.map((clip, index) => (
        <PitchVideoControl
          key={clip.id}
          clip={clip}
          selected={clip.id === selectedClipId}
          atBack={index === 0}
          atFront={index === clips.length - 1}
          onSelect={() => onSelectClip(clip.id)}
          onChange={(update) => onChange(clip.id, update)}
          onReorder={(direction) => onReorder(clip.id, direction)}
        />
      ))}
    </div>
  );
}
