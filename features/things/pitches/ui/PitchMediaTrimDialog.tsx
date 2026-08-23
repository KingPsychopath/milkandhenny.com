import { useEffect, useMemo, useRef, useState } from "react";

import { PITCH_MEDIA_MAX_SECONDS, type PitchMediaKind } from "../types";

const MINIMUM_MS = 500;

function time(milliseconds: number): string {
  const totalSeconds = Math.round(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function PitchMediaTrimDialog({
  file,
  sourceDurationMs,
  kind,
  onCancel,
  onConfirm,
}: {
  file: File;
  sourceDurationMs: number;
  kind: PitchMediaKind;
  onCancel: () => void;
  onConfirm: (selection: { startMs: number; durationMs: number }) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [startMs, setStartMs] = useState(0);
  const [durationMs, setDurationMs] = useState(
    Math.min(sourceDurationMs, PITCH_MEDIA_MAX_SECONDS * 1_000),
  );
  const url = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      URL.revokeObjectURL(url);
    };
  }, [url]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="pitch-media-trim-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(42rem,calc(100vw-3rem))] border theme-border bg-background p-0 text-foreground backdrop:bg-foreground/20"
    >
      <header className="border-b theme-border px-6 py-5">
        <p className="font-mono text-micro uppercase tracking-[0.12em] theme-muted">
          media is longer than two minutes
        </p>
        <h2 id="pitch-media-trim-title" className="mt-2 font-serif text-2xl">
          Choose the part to use
        </h2>
        <p className="mt-2 truncate font-mono text-xs theme-muted">{file.name}</p>
      </header>
      <div className="space-y-5 px-6 py-5">
        {kind === "video" ? (
          <video src={url} controls preload="metadata" className="max-h-72 w-full bg-foreground" />
        ) : (
          <audio src={url} controls preload="metadata" className="w-full" />
        )}
        <label className="block font-mono text-xs theme-muted">
          starts at · {time(startMs)}
          <input
            type="range"
            min={0}
            max={Math.max(0, sourceDurationMs - MINIMUM_MS)}
            step={100}
            value={startMs}
            onChange={(event) => {
              const nextStart = Number(event.target.value);
              setStartMs(nextStart);
              setDurationMs((current) =>
                Math.min(current, sourceDurationMs - nextStart, PITCH_MEDIA_MAX_SECONDS * 1_000),
              );
            }}
            className="mt-2 block min-h-8 w-full accent-[var(--prose-hashtag)]"
          />
        </label>
        <label className="block font-mono text-xs theme-muted">
          length · {time(durationMs)}
          <input
            type="range"
            min={Math.min(MINIMUM_MS, sourceDurationMs - startMs)}
            max={Math.min(sourceDurationMs - startMs, PITCH_MEDIA_MAX_SECONDS * 1_000)}
            step={100}
            value={durationMs}
            onChange={(event) => setDurationMs(Number(event.target.value))}
            className="mt-2 block min-h-8 w-full accent-[var(--prose-hashtag)]"
          />
        </label>
        <p className="font-mono text-micro leading-relaxed theme-muted">
          The original file stays on your device. Only this selected section is optimized and
          uploaded.
        </p>
        <div className="flex justify-end gap-3 border-t theme-border pt-4">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-60"
          >
            cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ startMs, durationMs })}
            className="min-h-11 bg-foreground px-4 font-mono text-xs text-background hover:opacity-80"
          >
            use this section
          </button>
        </div>
      </div>
    </dialog>
  );
}
