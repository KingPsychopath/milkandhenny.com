import { useEffect, useMemo, useState } from "react";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";

import type { PitchAsset, PitchDocument } from "../types";
import { ExcalidrawSurface } from "./ExcalidrawSurface";
import { usePitchAudioPlayback } from "./usePitchAudioPlayback";

export function PitchPreview({
  title,
  document,
  files,
  assets,
  initialSlideId,
  onClose,
}: {
  title: string;
  document: PitchDocument;
  files: BinaryFiles;
  assets: PitchAsset[];
  initialSlideId?: string;
  onClose: () => void;
}) {
  const slides = useMemo(
    () => document.slides.filter((slide) => !slide.deletedAt),
    [document.slides],
  );
  const initialIndex = Math.max(
    0,
    slides.findIndex((slide) => slide.id === initialSlideId),
  );
  const [index, setIndex] = useState(initialIndex);
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState(true);
  const slide = slides[index] ?? slides[0];
  const audio = usePitchAudioPlayback({ slide, assets, armed: sound });

  useEffect(() => {
    if (!playing || !slide) return;
    const timer = window.setTimeout(() => {
      if (index >= slides.length - 1) {
        setPlaying(false);
        return;
      }
      setIndex((current) => current + 1);
    }, slide.durationMs);
    return () => window.clearTimeout(timer);
  }, [index, playing, slide, slides.length]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight")
        setIndex((current) => Math.min(slides.length - 1, current + 1));
      if (event.key === "ArrowLeft") setIndex((current) => Math.max(0, current - 1));
      if (event.key === " ") {
        event.preventDefault();
        setPlaying((current) => !current);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [onClose, slides.length]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pitch-preview-title"
    >
      <header className="flex flex-wrap items-center gap-3 border-b theme-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-micro uppercase tracking-[0.14em] theme-muted">
            audience preview
          </p>
          <h2 id="pitch-preview-title" className="truncate font-serif text-xl text-foreground">
            {title}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => {
            setSound(true);
            audio.replay();
          }}
          className="min-h-10 border-b theme-border px-3 font-mono text-xs"
        >
          replay slide
        </button>
        <button
          type="button"
          onClick={() => setSound((current) => !current)}
          className="min-h-10 border-b theme-border px-3 font-mono text-xs"
        >
          sound {sound ? "on" : "off"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="min-h-10 bg-foreground px-5 font-mono text-xs text-background"
        >
          back to editing
        </button>
      </header>
      <section className="relative min-h-0 flex-1">
        <ExcalidrawSurface
          key={slide.id}
          slideId={slide.id}
          elements={slide.elements}
          files={files}
          readOnly
        />
      </section>
      <footer className="flex items-center justify-center gap-3 border-t theme-border px-4 py-3">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => setIndex((current) => Math.max(0, current - 1))}
          className="min-h-11 min-w-11 font-mono disabled:opacity-25"
          aria-label="Previous slide"
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => setPlaying((current) => !current)}
          className="min-h-11 min-w-32 bg-foreground px-4 font-mono text-xs text-background"
        >
          {playing ? "pause" : "play through"}
        </button>
        <span className="min-w-16 text-center font-mono text-xs theme-muted">
          {index + 1} / {slides.length}
        </span>
        <button
          type="button"
          disabled={index >= slides.length - 1}
          onClick={() => setIndex((current) => Math.min(slides.length - 1, current + 1))}
          className="min-h-11 min-w-11 font-mono disabled:opacity-25"
          aria-label="Next slide"
        >
          →
        </button>
      </footer>
    </div>
  );
}
