import { AppSelect } from "@/components/AppSelect";
import type { PitchAsset, PitchAudioCue, PitchSlide } from "../types";
import { PITCH_AUDIO_CUE_LIMIT, PITCH_SLIDE_DURATION_RANGE_MS } from "../types";

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(milliseconds % 1_000 === 0 ? 0 : 1)}s`;
}

function cueLabel(cue: PitchAudioCue, assets: PitchAsset[]): string {
  return assets.find((asset) => asset.id === cue.assetId)?.fileName ?? "sound";
}

export function PitchAudioTimeline({
  slide,
  assets,
  onChange,
  onAddSound,
  soundDisabledReason,
}: {
  slide: PitchSlide;
  assets: PitchAsset[];
  onChange: (slide: PitchSlide) => void;
  onAddSound: (event: React.ChangeEvent<HTMLInputElement>) => void;
  soundDisabledReason?: string;
}) {
  const updateCue = (cueId: string, update: (cue: PitchAudioCue) => PitchAudioCue) => {
    onChange({
      ...slide,
      audioCues: slide.audioCues.map((cue) => (cue.id === cueId ? update(cue) : cue)),
      version: slide.version + 1,
      updatedAt: Date.now(),
    });
  };

  const setDuration = (durationMs: number) => {
    const next = Math.min(
      PITCH_SLIDE_DURATION_RANGE_MS.max,
      Math.max(PITCH_SLIDE_DURATION_RANGE_MS.min, durationMs),
    );
    onChange({
      ...slide,
      durationMs: next,
      audioCues: slide.audioCues.map((cue) =>
        cue.trigger === "enter" && cue.delayMs > next ? { ...cue, delayMs: next } : cue,
      ),
      version: slide.version + 1,
      updatedAt: Date.now(),
    });
  };

  return (
    <section
      data-tour="sound"
      className="border-t theme-border bg-background px-3 py-3"
      aria-labelledby="pitch-sound-title"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 id="pitch-sound-title" className="font-mono text-xs text-foreground">
            sound + timing
          </h2>
          <p className="font-mono text-micro theme-muted">
            slide length {seconds(slide.durationMs)} · used by play-through preview
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDuration(slide.durationMs - 5_000)}
            className="min-h-10 min-w-10 border theme-border font-mono text-sm"
            aria-label="Shorten slide by five seconds"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setDuration(slide.durationMs + 5_000)}
            className="min-h-10 min-w-10 border theme-border font-mono text-sm"
            aria-label="Lengthen slide by five seconds"
          >
            +
          </button>
        </div>
        <label
          className={`inline-flex min-h-10 items-center border-b theme-border-strong px-2 font-mono text-xs ${
            soundDisabledReason || slide.audioCues.length >= PITCH_AUDIO_CUE_LIMIT
              ? "cursor-not-allowed opacity-35"
              : "cursor-pointer hover:opacity-60"
          }`}
        >
          + sound
          <input
            type="file"
            accept="audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm"
            className="sr-only"
            disabled={
              Boolean(soundDisabledReason) || slide.audioCues.length >= PITCH_AUDIO_CUE_LIMIT
            }
            onChange={onAddSound}
          />
        </label>
      </div>

      <div className="relative mt-3 h-9 overflow-hidden border theme-border bg-surface">
        <div className="absolute inset-y-0 left-1/4 border-l theme-border-faint" />
        <div className="absolute inset-y-0 left-1/2 border-l theme-border-faint" />
        <div className="absolute inset-y-0 left-3/4 border-l theme-border-faint" />
        {slide.audioCues.map((cue, index) => {
          const left =
            cue.trigger === "exit"
              ? 92
              : Math.min(92, (cue.delayMs / Math.max(1, slide.durationMs)) * 100);
          const width = Math.max(
            5,
            Math.min(100 - left, (cue.playForMs / Math.max(1, slide.durationMs)) * 100),
          );
          return (
            <span
              key={cue.id}
              className="absolute top-1 h-6 overflow-hidden bg-[var(--selection-bg)] px-2 font-mono text-micro leading-6 text-[var(--selection-fg)]"
              style={{ left: `${left}%`, width: `${width}%`, marginTop: `${index * 2}px` }}
              title={`${cueLabel(cue, assets)} · ${cue.trigger}`}
            >
              {cue.trigger === "exit" ? "exit" : cueLabel(cue, assets)}
            </span>
          );
        })}
      </div>

      {slide.audioCues.length === 0 ? (
        <p className="mt-3 font-mono text-micro theme-muted">
          {soundDisabledReason ??
            "Add a sting, song or sound effect. Nothing plays until a person presses preview or arms sound on the presentation screen."}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {slide.audioCues.map((cue) => {
            const availableMs = cue.sourceDurationMs - cue.startAtMs;
            return (
              <article key={cue.id} className="border-t theme-border pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                    {cueLabel(cue, assets)}
                  </p>
                  <AppSelect
                    value={cue.trigger}
                    ariaLabel={`When ${cueLabel(cue, assets)} starts`}
                    options={[
                      { value: "enter", label: "on slide entry" },
                      { value: "exit", label: "when leaving" },
                    ]}
                    onValueChange={(value) =>
                      updateCue(cue.id, (current) => ({
                        ...current,
                        trigger: value === "exit" ? "exit" : "enter",
                        delayMs:
                          value === "exit"
                            ? current.delayMs
                            : Math.min(current.delayMs, slide.durationMs),
                        end: value === "exit" ? "clip-end" : current.end,
                      }))
                    }
                  />
                  <AppSelect
                    value={cue.end}
                    disabled={cue.trigger === "exit"}
                    ariaLabel={`When ${cueLabel(cue, assets)} stops`}
                    options={[
                      { value: "slide-exit", label: "stop at next slide" },
                      { value: "clip-end", label: "let it finish" },
                    ]}
                    onValueChange={(value) =>
                      updateCue(cue.id, (current) => ({
                        ...current,
                        end: value === "clip-end" ? "clip-end" : "slide-exit",
                      }))
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...slide,
                        audioCues: slide.audioCues.filter((item) => item.id !== cue.id),
                        version: slide.version + 1,
                        updatedAt: Date.now(),
                      })
                    }
                    className="min-h-10 px-2 font-mono text-xs theme-muted underline underline-offset-4"
                  >
                    remove
                  </button>
                </div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="font-mono text-micro theme-muted">
                    delay · {seconds(cue.delayMs)}
                    <input
                      type="range"
                      min={0}
                      max={cue.trigger === "enter" ? slide.durationMs : 30_000}
                      step={500}
                      value={cue.delayMs}
                      onChange={(event) =>
                        updateCue(cue.id, (current) => ({
                          ...current,
                          delayMs: Number(event.target.value),
                        }))
                      }
                      className="mt-1 block min-h-8 w-full accent-[var(--prose-hashtag)]"
                    />
                  </label>
                  <label className="font-mono text-micro theme-muted">
                    starts at · {seconds(cue.startAtMs)}
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, cue.sourceDurationMs - 500)}
                      step={500}
                      value={cue.startAtMs}
                      onChange={(event) =>
                        updateCue(cue.id, (current) => {
                          const startAtMs = Number(event.target.value);
                          return {
                            ...current,
                            startAtMs,
                            playForMs: Math.min(
                              current.playForMs,
                              current.sourceDurationMs - startAtMs,
                            ),
                          };
                        })
                      }
                      className="mt-1 block min-h-8 w-full accent-[var(--prose-hashtag)]"
                    />
                  </label>
                  <label className="font-mono text-micro theme-muted">
                    plays for · {seconds(cue.playForMs)}
                    <input
                      type="range"
                      min={Math.min(500, availableMs)}
                      max={availableMs}
                      step={500}
                      value={cue.playForMs}
                      onChange={(event) =>
                        updateCue(cue.id, (current) => ({
                          ...current,
                          playForMs: Number(event.target.value),
                        }))
                      }
                      className="mt-1 block min-h-8 w-full accent-[var(--prose-hashtag)]"
                    />
                  </label>
                  <label className="font-mono text-micro theme-muted">
                    volume · {Math.round(cue.volume * 100)}%
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={cue.volume}
                      onChange={(event) =>
                        updateCue(cue.id, (current) => ({
                          ...current,
                          volume: Number(event.target.value),
                        }))
                      }
                      className="mt-1 block min-h-8 w-full accent-[var(--prose-hashtag)]"
                    />
                  </label>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
