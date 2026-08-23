import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";

import type { PublicPitchDeckDetail } from "../types";
import { ExcalidrawSurface } from "./ExcalidrawSurface";
import { loadPitchFiles } from "./files.client";
import { usePitchAudioPlayback } from "./usePitchAudioPlayback";

export function PitchViewer({ pitch }: { pitch: PublicPitchDeckDetail }) {
  const slides = useMemo(
    () => pitch.document.slides.filter((slide) => !slide.deletedAt),
    [pitch.document],
  );
  const [index, setIndex] = useState(0);
  const [files, setFiles] = useState<BinaryFiles>({});
  const [sound, setSound] = useState(false);
  const slide = slides[index] ?? slides[0];
  const audio = usePitchAudioPlayback({ slide, assets: pitch.assets, armed: sound });

  useEffect(() => {
    void loadPitchFiles(pitch.assets).then(setFiles);
  }, [pitch.assets]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("button, a, input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      if (event.key === "ArrowRight" || event.key === " ") {
        if (event.key === " ") event.preventDefault();
        setIndex((current) => Math.min(slides.length - 1, current + 1));
      }
      if (event.key === "ArrowLeft") setIndex((current) => Math.max(0, current - 1));
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [slides.length]);

  return (
    <main id="main" className="flex min-h-screen flex-col bg-background">
      <header className="flex flex-wrap items-center gap-4 border-b theme-border px-4 py-3">
        <Link to="/things/pitches" className="font-mono text-xs theme-muted hover:opacity-60">
          ← pitch wall
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-serif text-xl text-foreground">{pitch.title}</h1>
          <p className="font-mono text-micro uppercase tracking-[0.12em] theme-muted">
            by {pitch.ownerName} · sealed edition
          </p>
        </div>
        <Link
          to="/things/pitches/new"
          className="font-mono text-xs text-foreground underline underline-offset-4 hover:opacity-60"
        >
          make yours
        </Link>
      </header>
      <section className="relative min-h-[60vh] flex-1">
        <div className="absolute inset-0">
          <ExcalidrawSurface
            key={slide.id}
            slideId={slide.id}
            elements={slide.elements}
            files={files}
            readOnly
          />
        </div>
      </section>
      <footer className="flex flex-wrap items-center justify-center gap-4 border-t theme-border px-4 py-3">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => setIndex((current) => Math.max(0, current - 1))}
          className="min-h-10 px-4 font-mono text-sm disabled:opacity-25"
          aria-label="Previous slide"
        >
          ←
        </button>
        <span className="font-mono text-xs theme-muted">
          {index + 1} / {slides.length}
        </span>
        <button
          type="button"
          disabled={index >= slides.length - 1}
          onClick={() => setIndex((current) => Math.min(slides.length - 1, current + 1))}
          className="min-h-10 px-4 font-mono text-sm disabled:opacity-25"
          aria-label="Next slide"
        >
          →
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
          onClick={() => {
            setSound(true);
            audio.replay();
          }}
          className="min-h-10 px-3 font-mono text-xs theme-muted"
        >
          replay
        </button>
      </footer>
    </main>
  );
}
