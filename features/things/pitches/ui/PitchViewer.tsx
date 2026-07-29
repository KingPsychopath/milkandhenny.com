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
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState(false);
  const slide = slides[index] ?? slides[0];
  const audio = usePitchAudioPlayback({ slide, assets: pitch.assets, armed: sound });

  useEffect(() => {
    void loadPitchFiles(pitch.assets).then(setFiles);
  }, [pitch.assets]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === " ") {
        setIndex((current) => Math.min(slides.length - 1, current + 1));
      }
      if (event.key === "ArrowLeft") setIndex((current) => Math.max(0, current - 1));
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [slides.length]);

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
        <ExcalidrawSurface
          key={slide.id}
          slideId={slide.id}
          elements={slide.elements}
          files={files}
          readOnly
        />
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
          onClick={() => {
            setSound(true);
            setPlaying((current) => !current);
          }}
          className="min-h-10 bg-foreground px-4 font-mono text-xs text-background"
        >
          {playing ? "pause" : "play through"}
        </button>
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
