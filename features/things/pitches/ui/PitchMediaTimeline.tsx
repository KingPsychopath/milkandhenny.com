import { useMemo, useRef, useState } from "react";

import {
  PITCH_MEDIA_CLIP_LIMIT,
  PITCH_SLIDE_DURATION_RANGE_MS,
  type PitchAsset,
  type PitchCommandKind,
  type PitchMediaClip,
  type PitchSlide,
} from "../types";

const SNAP_MS = 100;
const MIN_CLIP_MS = 500;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function snap(value: number): number {
  return Math.round(value / SNAP_MS) * SNAP_MS;
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(milliseconds % 1_000 === 0 ? 0 : 1)}s`;
}

function clipLabel(clip: PitchMediaClip, assets: PitchAsset[]): string {
  return assets.find((asset) => asset.id === clip.assetId)?.fileName ?? clip.kind;
}

function clipUrl(clip: PitchMediaClip, assets: PitchAsset[]): string | undefined {
  return assets.find((asset) => asset.id === clip.assetId && asset.availability === "available")
    ?.url;
}

function clipUnavailable(clip: PitchMediaClip, assets: PitchAsset[]): boolean {
  const asset = assets.find((candidate) => candidate.id === clip.assetId);
  return !asset || asset.availability === "unavailable" || !asset.url;
}

function clipStorageLabel(clip: PitchMediaClip, assets: PitchAsset[]): string {
  const asset = assets.find((candidate) => candidate.id === clip.assetId);
  if (!asset || asset.availability === "unavailable") return "unavailable";
  if (asset.transferState === "local") return "safe on device";
  if (asset.transferState === "uploading") return "securing";
  if (asset.transferState === "error") return "safe here · retry needed";
  return "secured";
}

function arrangeClipLanes(clips: PitchMediaClip[]): PitchMediaClip[][] {
  const lanes: PitchMediaClip[][] = [];
  for (const clip of clips.toSorted(
    (left, right) =>
      left.timelineStartMs - right.timelineStartMs || left.id.localeCompare(right.id),
  )) {
    const lane = lanes.find(
      (candidate) =>
        (candidate.at(-1)?.timelineStartMs ?? 0) + (candidate.at(-1)?.durationMs ?? 0) <=
        clip.timelineStartMs,
    );
    if (lane) lane.push(clip);
    else lanes.push([clip]);
  }
  return lanes.length > 0 ? lanes : [[]];
}

type Gesture = {
  pointerId: number;
  clipId: string;
  mode: "move" | "trim-start" | "trim-end";
  startX: number;
  width: number;
  clips: PitchMediaClip[];
};

function timingGroup(clips: PitchMediaClip[], clip: PitchMediaClip): PitchMediaClip[] {
  return clip.linkedGroupId
    ? clips.filter((candidate) => candidate.linkedGroupId === clip.linkedGroupId)
    : [clip];
}

function updateGestureClips(
  gesture: Gesture,
  deltaMs: number,
  slideDurationMs: number,
): PitchMediaClip[] {
  const subject = gesture.clips.find((clip) => clip.id === gesture.clipId);
  if (!subject || subject.locked) return gesture.clips;
  const group = timingGroup(gesture.clips, subject);
  if (group.some((clip) => clip.locked)) return gesture.clips;
  const groupIds = new Set(group.map((clip) => clip.id));
  const delta = snap(deltaMs);
  let patch: Pick<PitchMediaClip, "timelineStartMs" | "sourceStartMs" | "durationMs">;

  if (gesture.mode === "move") {
    const earliest = Math.min(...group.map((clip) => clip.timelineStartMs));
    const latest = Math.max(...group.map((clip) => clip.timelineStartMs + clip.durationMs));
    const bounded = clamp(delta, -earliest, slideDurationMs - latest);
    return gesture.clips.map((clip) =>
      groupIds.has(clip.id)
        ? { ...clip, timelineStartMs: snap(clip.timelineStartMs + bounded) }
        : clip,
    );
  }

  if (gesture.mode === "trim-start") {
    const maximumDelta = Math.min(
      ...group.map((clip) =>
        Math.min(
          clip.durationMs - MIN_CLIP_MS,
          clip.sourceDurationMs - clip.sourceStartMs - MIN_CLIP_MS,
        ),
      ),
    );
    const minimumDelta = -Math.min(
      ...group.map((clip) => Math.min(clip.timelineStartMs, clip.sourceStartMs)),
    );
    const bounded = clamp(delta, minimumDelta, maximumDelta);
    return gesture.clips.map((clip) =>
      groupIds.has(clip.id)
        ? {
            ...clip,
            timelineStartMs: snap(clip.timelineStartMs + bounded),
            sourceStartMs: snap(clip.sourceStartMs + bounded),
            durationMs: snap(clip.durationMs - bounded),
          }
        : clip,
    );
  }

  const maximumDelta = Math.min(
    ...group.map((clip) =>
      clip.loop
        ? slideDurationMs - clip.timelineStartMs - clip.durationMs
        : Math.min(
            clip.sourceDurationMs - clip.sourceStartMs - clip.durationMs,
            slideDurationMs - clip.timelineStartMs - clip.durationMs,
          ),
    ),
  );
  const minimumDelta = -Math.min(...group.map((clip) => clip.durationMs - MIN_CLIP_MS));
  const bounded = clamp(delta, minimumDelta, maximumDelta);
  patch = {
    timelineStartMs: subject.timelineStartMs,
    sourceStartMs: subject.sourceStartMs,
    durationMs: snap(subject.durationMs + bounded),
  };
  return gesture.clips.map((clip) =>
    groupIds.has(clip.id) ? { ...clip, durationMs: patch.durationMs } : clip,
  );
}

export function PitchMediaTimeline({
  slide,
  assets,
  playheadMs,
  playing,
  selectedClipId,
  onSelectClip,
  disabledReason,
  processingLabel,
  onAddMedia,
  onDropFiles,
  onScrub,
  onTogglePlayback,
  onChange,
}: {
  slide: PitchSlide;
  assets: PitchAsset[];
  playheadMs: number;
  playing: boolean;
  selectedClipId?: string;
  onSelectClip: (clipId: string) => void;
  disabledReason?: string;
  processingLabel?: string;
  onAddMedia: (file: File) => void;
  onDropFiles?: (files: FileList) => void;
  onScrub: (milliseconds: number) => void;
  onTogglePlayback: () => void;
  onChange: (slide: PitchSlide, kind?: PitchCommandKind) => void;
}) {
  const [dropActive, setDropActive] = useState(false);
  const [layersExpanded, setLayersExpanded] = useState(false);
  const [gesture, setGesture] = useState<Gesture>();
  const [draftClips, setDraftClips] = useState<PitchMediaClip[]>();
  const timelineRef = useRef<HTMLDivElement>(null);
  const clips = draftClips ?? slide.mediaClips;
  const selected = clips.find((clip) => clip.id === selectedClipId);
  const selectedGroup = selected ? timingGroup(slide.mediaClips, selected) : [];
  const trackLanes = useMemo(
    () => ({
      video: arrangeClipLanes(clips.filter((clip) => clip.kind === "video")),
      audio: arrangeClipLanes(clips.filter((clip) => clip.kind === "audio")),
    }),
    [clips],
  );
  const minimumSlideDuration = Math.max(
    PITCH_SLIDE_DURATION_RANGE_MS.min,
    ...slide.mediaClips.map((clip) => clip.timelineStartMs + clip.durationMs),
  );
  const laneCount = trackLanes.video.length + trackLanes.audio.length;
  const layersOverflow = laneCount > 2;

  const commit = (nextClips: PitchMediaClip[], kind: PitchCommandKind = "media.change") => {
    onChange(
      {
        ...slide,
        mediaClips: nextClips,
        version: slide.version + 1,
        updatedAt: Date.now(),
      },
      kind,
    );
  };

  const updateClip = (
    clipId: string,
    update: (clip: PitchMediaClip) => PitchMediaClip,
    linkedTiming = false,
  ) => {
    const source = slide.mediaClips.find((clip) => clip.id === clipId);
    if (!source || source.locked) return;
    const nextSource = update(source);
    const next = slide.mediaClips.map((clip) => {
      if (clip.id === clipId) return nextSource;
      if (!linkedTiming || !source.linkedGroupId || clip.linkedGroupId !== source.linkedGroupId) {
        return clip;
      }
      if (clip.locked) return clip;
      return {
        ...clip,
        timelineStartMs: nextSource.timelineStartMs,
        sourceStartMs: nextSource.sourceStartMs,
        durationMs: Math.min(
          nextSource.durationMs,
          slide.durationMs - nextSource.timelineStartMs,
          clip.loop ? Number.POSITIVE_INFINITY : clip.sourceDurationMs - nextSource.sourceStartMs,
        ),
      };
    });
    commit(next);
  };

  const setSlideDuration = (requested: number) => {
    const clipEnd = Math.max(
      0,
      ...slide.mediaClips.map((clip) => clip.timelineStartMs + clip.durationMs),
    );
    const durationMs = clamp(
      Math.max(requested, clipEnd),
      PITCH_SLIDE_DURATION_RANGE_MS.min,
      PITCH_SLIDE_DURATION_RANGE_MS.max,
    );
    onChange(
      { ...slide, durationMs, version: slide.version + 1, updatedAt: Date.now() },
      "slide.timing",
    );
    onScrub(Math.min(playheadMs, durationMs));
  };

  const beginGesture = (
    event: React.PointerEvent<HTMLElement>,
    clip: PitchMediaClip,
    mode: Gesture["mode"],
  ) => {
    if (clip.locked) return;
    const width = timelineRef.current?.getBoundingClientRect().width ?? 1;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectClip(clip.id);
    setGesture({
      pointerId: event.pointerId,
      clipId: clip.id,
      mode,
      startX: event.clientX,
      width,
      clips: slide.mediaClips,
    });
    setDraftClips(slide.mediaClips);
  };

  const finishGesture = () => {
    if (draftClips && gesture) commit(draftClips);
    setGesture(undefined);
    setDraftClips(undefined);
  };

  const toggleLink = (clip: PitchMediaClip) => {
    if (clip.linkedGroupId) {
      commit(
        slide.mediaClips.map((candidate) =>
          candidate.linkedGroupId === clip.linkedGroupId
            ? { ...candidate, linkedGroupId: undefined }
            : candidate,
        ),
      );
      return;
    }
    const sibling = slide.mediaClips.find(
      (candidate) => candidate.assetId === clip.assetId && candidate.kind !== clip.kind,
    );
    if (!sibling || sibling.locked) return;
    const linkedGroupId = `link_${crypto.randomUUID().replaceAll("-", "")}`;
    const nextLoop = clip.loop;
    const sharedDuration = Math.min(
      clip.durationMs,
      slide.durationMs - clip.timelineStartMs,
      nextLoop ? Number.POSITIVE_INFINITY : clip.sourceDurationMs - clip.sourceStartMs,
      nextLoop ? Number.POSITIVE_INFINITY : sibling.sourceDurationMs - clip.sourceStartMs,
    );
    commit(
      slide.mediaClips.map((candidate) =>
        candidate.id === clip.id || candidate.id === sibling.id
          ? {
              ...candidate,
              linkedGroupId,
              timelineStartMs: clip.timelineStartMs,
              sourceStartMs: clip.sourceStartMs,
              durationMs: sharedDuration,
              loop: nextLoop,
            }
          : candidate,
      ),
    );
  };

  const toggleLoop = (clip: PitchMediaClip) => {
    const group = timingGroup(slide.mediaClips, clip);
    if (group.some((candidate) => candidate.locked)) return;
    const groupIds = new Set(group.map((candidate) => candidate.id));
    const loop = !clip.loop;
    const sharedDuration = loop
      ? clip.durationMs
      : Math.min(
          clip.durationMs,
          ...group.map((candidate) => candidate.sourceDurationMs - candidate.sourceStartMs),
        );
    commit(
      slide.mediaClips.map((candidate) =>
        groupIds.has(candidate.id) ? { ...candidate, loop, durationMs: sharedDuration } : candidate,
      ),
    );
  };

  const splitAtPlayhead = (clip: PitchMediaClip) => {
    const offset = playheadMs - clip.timelineStartMs;
    if (offset < MIN_CLIP_MS || clip.durationMs - offset < MIN_CLIP_MS) return;
    const group = timingGroup(slide.mediaClips, clip);
    if (slide.mediaClips.length + group.length > PITCH_MEDIA_CLIP_LIMIT) return;
    if (group.some((candidate) => candidate.locked || candidate.loop)) return;
    const groupIds = new Set(group.map((candidate) => candidate.id));
    const secondLinkedGroupId = clip.linkedGroupId
      ? `link_${crypto.randomUUID().replaceAll("-", "")}`
      : undefined;
    const next = slide.mediaClips.flatMap((candidate) => {
      if (!groupIds.has(candidate.id)) return [candidate];
      return [
        { ...candidate, durationMs: offset },
        {
          ...candidate,
          id: `${candidate.kind}_${crypto.randomUUID().replaceAll("-", "")}`,
          timelineStartMs: candidate.timelineStartMs + offset,
          sourceStartMs: candidate.sourceStartMs + offset,
          durationMs: candidate.durationMs - offset,
          linkedGroupId: secondLinkedGroupId,
        },
      ];
    });
    commit(next);
  };

  return (
    <section
      data-tour="sound"
      data-pitch-drop-target="timeline"
      aria-labelledby="pitch-media-title"
      aria-busy={Boolean(processingLabel)}
      className={`border-t theme-border bg-background px-3 py-3 ${dropActive ? "ring-2 ring-inset ring-[var(--things-amber)]" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDropActive(false);
        if (event.dataTransfer.files.length > 0) onDropFiles?.(event.dataTransfer.files);
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 id="pitch-media-title" className="font-mono text-xs text-foreground">
            media timeline
          </h2>
          <p className="font-mono text-micro theme-muted">
            {seconds(slide.durationMs)} · the clock stops here · next slide is manual
          </p>
        </div>
        <button
          type="button"
          id="pitch-media-layers-toggle"
          aria-expanded={layersExpanded}
          aria-controls="pitch-media-layers"
          disabled={!layersOverflow}
          onClick={() => setLayersExpanded((current) => !current)}
          className="min-h-11 border-b theme-border px-3 font-mono text-xs hover:opacity-60 disabled:opacity-35"
        >
          {layersExpanded
            ? "collapse lanes"
            : layersOverflow
              ? `expand ${laneCount} lanes`
              : "2 lanes"}
        </button>
        <button
          type="button"
          onClick={onTogglePlayback}
          className="min-h-11 border theme-border-strong px-3 font-mono text-xs hover:opacity-60"
        >
          {playing ? "pause" : playheadMs > 0 ? "continue" : "play"}
        </button>
        <button
          type="button"
          onClick={() => onScrub(0)}
          className="min-h-11 min-w-11 border theme-border font-mono text-xs hover:opacity-60"
          aria-label="Return playhead to start"
        >
          ↤
        </button>
        <button
          type="button"
          disabled={slide.durationMs <= minimumSlideDuration}
          onClick={() => setSlideDuration(slide.durationMs - 5_000)}
          className="min-h-11 min-w-11 border theme-border font-mono text-sm disabled:opacity-35"
          aria-label="Shorten slide timeline by five seconds"
        >
          −
        </button>
        <button
          type="button"
          disabled={slide.durationMs >= PITCH_SLIDE_DURATION_RANGE_MS.max}
          onClick={() => setSlideDuration(slide.durationMs + 5_000)}
          className="min-h-11 min-w-11 border theme-border font-mono text-sm disabled:opacity-35"
          aria-label="Lengthen slide timeline by five seconds"
        >
          +
        </button>
        <label
          className={`inline-flex min-h-11 items-center border-b theme-border-strong px-3 font-mono text-xs ${
            disabledReason || processingLabel || slide.mediaClips.length >= PITCH_MEDIA_CLIP_LIMIT
              ? "cursor-not-allowed opacity-35"
              : "cursor-pointer hover:opacity-60"
          }`}
        >
          {processingLabel ?? "+ media"}
          <input
            type="file"
            accept="audio/*,video/*,.mp3,.m4a,.aac,.ogg,.wav,.webm,.mp4,.mov,.m4v,.avi,.mkv"
            className="sr-only"
            disabled={
              Boolean(disabledReason || processingLabel) ||
              slide.mediaClips.length >= PITCH_MEDIA_CLIP_LIMIT
            }
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onAddMedia(file);
            }}
          />
        </label>
      </div>

      <label className="mt-3 block font-mono text-micro theme-muted">
        playhead · {seconds(playheadMs)}
        <input
          type="range"
          min={0}
          max={slide.durationMs}
          step={SNAP_MS}
          value={Math.min(playheadMs, slide.durationMs)}
          onChange={(event) => onScrub(Number(event.target.value))}
          className="mt-1 block min-h-11 w-full accent-[var(--prose-hashtag)]"
        />
      </label>

      <div
        id="pitch-media-layers"
        aria-labelledby="pitch-media-layers-toggle"
        className={`mt-2 overflow-y-auto overscroll-contain border-y theme-border ${
          layersExpanded ? "max-h-[50vh]" : "max-h-40"
        }`}
      >
        <div
          ref={timelineRef}
          className="relative space-y-1 py-1"
          onPointerMove={(event) => {
            if (!gesture || event.pointerId !== gesture.pointerId) return;
            const deltaMs = ((event.clientX - gesture.startX) / gesture.width) * slide.durationMs;
            setDraftClips(updateGestureClips(gesture, deltaMs, slide.durationMs));
          }}
          onPointerUp={(event) => {
            if (gesture && event.pointerId === gesture.pointerId) finishGesture();
          }}
          onPointerCancel={finishGesture}
        >
          <span
            className="pointer-events-none absolute inset-y-0 z-30 w-px bg-[var(--prose-hashtag)]"
            style={{ left: `${(playheadMs / Math.max(1, slide.durationMs)) * 100}%` }}
          />
          {(["video", "audio"] as const).map((kind) => (
            <div key={kind} className="relative bg-surface pt-4">
              <span className="pointer-events-none absolute left-2 top-1 z-20 font-mono text-micro uppercase theme-faint">
                {kind}
                {trackLanes[kind].length > 1 ? ` · ${trackLanes[kind].length} lanes` : ""}
              </span>
              {trackLanes[kind].map((lane, laneIndex) => (
                <div
                  key={laneIndex}
                  className="relative h-12 border-t theme-border-faint first:border-t-0"
                >
                  {lane.map((clip) => {
                    const left = (clip.timelineStartMs / slide.durationMs) * 100;
                    const width = (clip.durationMs / slide.durationMs) * 100;
                    const unavailable = clipUnavailable(clip, assets);
                    const transferState = assets.find(
                      (asset) => asset.id === clip.assetId,
                    )?.transferState;
                    return (
                      <div
                        key={clip.id}
                        className={`absolute inset-y-1 overflow-hidden border ${
                          selectedClipId === clip.id
                            ? "border-[var(--things-amber)] bg-[var(--selection-bg)]"
                            : unavailable
                              ? "border-dashed border-[var(--things-amber)] bg-[var(--selection-bg)]"
                              : transferState === "uploading"
                                ? "border-[var(--things-amber)] bg-background motion-safe:animate-pulse"
                                : transferState === "local" || transferState === "error"
                                  ? "border-dashed border-[var(--things-amber)] bg-background"
                                  : "theme-border-strong bg-background"
                        } ${clip.locked ? "opacity-60" : ""}`}
                        style={{ left: `${left}%`, width: `${width}%`, minWidth: "2.75rem" }}
                      >
                        {clip.kind === "video" && clipUrl(clip, assets) ? (
                          <video
                            src={`${clipUrl(clip, assets)}#t=${clip.sourceStartMs / 1_000}`}
                            muted
                            playsInline
                            preload="metadata"
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-30"
                          />
                        ) : null}
                        <button
                          type="button"
                          onPointerDown={(event) => beginGesture(event, clip, "move")}
                          onClick={() => onSelectClip(clip.id)}
                          className="relative z-10 h-full w-full truncate px-8 text-left font-mono text-micro text-foreground"
                          aria-label={`Move ${clipLabel(clip, assets)}. ${clipStorageLabel(clip, assets)}. Starts at ${seconds(clip.timelineStartMs)} and lasts ${seconds(clip.durationMs)}.`}
                        >
                          {clip.locked ? "locked · " : ""}
                          {clipLabel(clip, assets)}
                          {` · ${clipStorageLabel(clip, assets)}`}
                        </button>
                        {!clip.locked ? (
                          <>
                            <button
                              type="button"
                              onPointerDown={(event) => beginGesture(event, clip, "trim-start")}
                              className="absolute inset-y-0 left-0 z-20 min-w-11 border-r theme-border bg-background/70 font-mono text-micro"
                              aria-label={`Trim the start of ${clipLabel(clip, assets)}`}
                            >
                              [
                            </button>
                            <button
                              type="button"
                              onPointerDown={(event) => beginGesture(event, clip, "trim-end")}
                              className="absolute inset-y-0 right-0 z-20 min-w-11 border-l theme-border bg-background/70 font-mono text-micro"
                              aria-label={`Trim the end of ${clipLabel(clip, assets)}`}
                            >
                              ]
                            </button>
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {selected ? (
        <div className="mt-3 border-t theme-border pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
              {clipLabel(selected, assets)} · {clipStorageLabel(selected, assets)}
            </p>
            <button
              type="button"
              onClick={() =>
                commit(
                  slide.mediaClips.map((clip) =>
                    clip.id === selected.id ||
                    (selected.linkedGroupId && clip.linkedGroupId === selected.linkedGroupId)
                      ? { ...clip, locked: !selected.locked }
                      : clip,
                  ),
                )
              }
              className="min-h-11 border-b theme-border px-2 font-mono text-xs hover:opacity-60"
            >
              {selected.locked ? "unlock" : "lock"}
            </button>
            {slide.mediaClips.some(
              (clip) => clip.assetId === selected.assetId && clip.kind !== selected.kind,
            ) ? (
              <button
                type="button"
                disabled={selected.locked}
                onClick={() => toggleLink(selected)}
                className="min-h-11 border-b theme-border px-2 font-mono text-xs hover:opacity-60 disabled:opacity-35"
              >
                {selected.linkedGroupId ? "unlink tracks" : "sync tracks"}
              </button>
            ) : null}
            <button
              type="button"
              aria-pressed={selected.loop}
              aria-label={`${selected.loop ? "Stop" : "Start"} repeating this clip`}
              disabled={selectedGroup.some((clip) => clip.locked)}
              onClick={() => toggleLoop(selected)}
              className="min-h-11 border-b theme-border px-2 font-mono text-xs hover:opacity-60 disabled:opacity-35"
            >
              {selected.loop ? "repeat on" : "repeat off"}
            </button>
            {selected.kind === "audio" ? (
              <button
                type="button"
                aria-pressed={selected.muted}
                disabled={selected.locked}
                onClick={() =>
                  updateClip(selected.id, (clip) => ({
                    ...clip,
                    muted: !clip.muted,
                    volume: clip.volume === 0 ? 0.85 : clip.volume,
                  }))
                }
                className="min-h-11 border-b theme-border px-2 font-mono text-xs hover:opacity-60 disabled:opacity-35"
              >
                {selected.muted ? "sound off" : "sound on"}
              </button>
            ) : null}
            <button
              type="button"
              disabled={
                selected.locked ||
                selectedGroup.some((clip) => clip.loop) ||
                slide.mediaClips.length + timingGroup(slide.mediaClips, selected).length >
                  PITCH_MEDIA_CLIP_LIMIT ||
                playheadMs - selected.timelineStartMs < MIN_CLIP_MS ||
                selected.timelineStartMs + selected.durationMs - playheadMs < MIN_CLIP_MS
              }
              onClick={() => splitAtPlayhead(selected)}
              title={
                selectedGroup.some((clip) => clip.loop)
                  ? "Turn repeat off before splitting"
                  : undefined
              }
              className="min-h-11 border-b theme-border px-2 font-mono text-xs hover:opacity-60 disabled:opacity-35"
            >
              split at playhead
            </button>
            <button
              type="button"
              onClick={() => {
                const next = slide.mediaClips
                  .filter((clip) => clip.id !== selected.id)
                  .map((clip) =>
                    clip.linkedGroupId === selected.linkedGroupId
                      ? { ...clip, linkedGroupId: undefined }
                      : clip,
                  );
                commit(next, "media.remove");
              }}
              className="min-h-11 px-2 font-mono text-xs theme-muted underline underline-offset-4 hover:opacity-60"
            >
              remove
            </button>
          </div>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="font-mono text-micro theme-muted">
              starts on slide · {seconds(selected.timelineStartMs)}
              <input
                type="range"
                min={0}
                max={Math.max(0, slide.durationMs - selected.durationMs)}
                step={SNAP_MS}
                value={selected.timelineStartMs}
                disabled={selected.locked}
                onChange={(event) =>
                  updateClip(
                    selected.id,
                    (clip) => ({ ...clip, timelineStartMs: Number(event.target.value) }),
                    true,
                  )
                }
                className="mt-1 block min-h-11 w-full accent-[var(--prose-hashtag)] disabled:opacity-35"
              />
            </label>
            <label className="font-mono text-micro theme-muted">
              source in · {seconds(selected.sourceStartMs)}
              <input
                type="range"
                min={0}
                max={Math.max(
                  0,
                  selected.loop
                    ? selected.sourceDurationMs - MIN_CLIP_MS
                    : selected.sourceDurationMs - selected.durationMs,
                )}
                step={SNAP_MS}
                value={selected.sourceStartMs}
                disabled={selected.locked}
                onChange={(event) =>
                  updateClip(
                    selected.id,
                    (clip) => ({ ...clip, sourceStartMs: Number(event.target.value) }),
                    true,
                  )
                }
                className="mt-1 block min-h-11 w-full accent-[var(--prose-hashtag)] disabled:opacity-35"
              />
            </label>
            <label className="font-mono text-micro theme-muted">
              length · {seconds(selected.durationMs)}
              <input
                type="range"
                min={Math.min(
                  MIN_CLIP_MS,
                  selected.loop
                    ? Number.POSITIVE_INFINITY
                    : selected.sourceDurationMs - selected.sourceStartMs,
                  slide.durationMs - selected.timelineStartMs,
                )}
                max={Math.min(
                  selected.loop
                    ? Number.POSITIVE_INFINITY
                    : selected.sourceDurationMs - selected.sourceStartMs,
                  slide.durationMs - selected.timelineStartMs,
                )}
                step={SNAP_MS}
                value={selected.durationMs}
                disabled={selected.locked}
                onChange={(event) =>
                  updateClip(
                    selected.id,
                    (clip) => ({ ...clip, durationMs: Number(event.target.value) }),
                    true,
                  )
                }
                className="mt-1 block min-h-11 w-full accent-[var(--prose-hashtag)] disabled:opacity-35"
              />
            </label>
            {selected.kind === "audio" ? (
              <label className="font-mono text-micro theme-muted">
                volume · {Math.round(selected.volume * 100)}%
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={selected.volume}
                  disabled={selected.locked}
                  onChange={(event) =>
                    updateClip(selected.id, (clip) => ({
                      ...clip,
                      muted: Number(event.target.value) === 0,
                      volume: Number(event.target.value),
                    }))
                  }
                  className="mt-1 block min-h-11 w-full accent-[var(--prose-hashtag)] disabled:opacity-35"
                />
              </label>
            ) : null}
            <p className="self-end pb-2 font-mono text-micro theme-muted">
              {selected.kind === "video"
                ? selected.loop
                  ? "Loop on. Position and resize this video on the slide above."
                  : "Position and resize this video on the slide above."
                : selected.loop
                  ? "Loop on. Extend the clip to repeat it."
                  : selected.linkedGroupId
                    ? "video + sound synced"
                    : `${selected.kind} independent`}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-3 font-mono text-micro theme-muted">
          {disabledReason ??
            "Drop video or sound here. Drag clips to move them, pull either edge to trim, and select a clip for precise controls."}
        </p>
      )}
    </section>
  );
}
