import { useEffect, useRef, useState } from "react";
import { Draw, type DrawHandle, type Stroke } from "drawesome";
import "drawesome/styles.css";

import type { PitchInkLayer, PitchInkStroke } from "../types";

function toDrawesome(strokes: PitchInkStroke[]): Stroke[] {
  return strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => [...point]),
  }));
}

function fromDrawesome(strokes: Stroke[]): PitchInkStroke[] {
  return strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => [...point]),
  }));
}

export function DrawesomeInk({
  initialLayer,
  onCancel,
  onPlace,
}: {
  initialLayer?: PitchInkLayer;
  onCancel: () => void;
  onPlace: (result: {
    name: string;
    strokes: PitchInkStroke[];
    board: { w: number; h: number };
    blob: Blob;
  }) => void | Promise<void>;
}) {
  const drawRef = useRef<DrawHandle>(null);
  const [strokes, setStrokes] = useState<PitchInkStroke[]>(initialLayer?.strokes ?? []);
  const [placing, setPlacing] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [swatches, setSwatches] = useState<string[]>();

  useEffect(() => {
    const resize = () => setNarrow(window.innerWidth < 640);
    resize();
    window.addEventListener("resize", resize);
    const styles = getComputedStyle(document.documentElement);
    setSwatches(
      [
        "--foreground",
        "--things-amber",
        "--things-green",
        "--things-country-inside",
        "--things-country-outside",
        "--stone-500",
      ]
        .map((token) => styles.getPropertyValue(token).trim())
        .filter(Boolean),
    );
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", keydown);
    };
  }, [onCancel]);

  async function place() {
    if (!drawRef.current || strokes.length === 0) return;
    setPlacing(true);
    try {
      await onPlace({
        name: initialLayer?.name ?? "Beautiful ink",
        strokes,
        board: drawRef.current.getSize(),
        blob: await drawRef.current.toPng(2),
      });
    } finally {
      setPlacing(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawesome-title"
    >
      <header className="flex flex-wrap items-center gap-4 border-b theme-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-micro uppercase tracking-[0.16em] theme-muted">
            drawesome ink layer
          </p>
          <h2 id="drawesome-title" className="font-serif text-xl text-foreground">
            Draw it like you mean it.
          </h2>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-10 px-3 font-mono text-xs theme-muted hover:opacity-60"
        >
          cancel
        </button>
        <button
          type="button"
          disabled={strokes.length === 0 || placing}
          onClick={() => void place()}
          className="min-h-10 bg-foreground px-5 font-mono text-xs text-background hover:opacity-80 disabled:opacity-30"
        >
          {placing ? "placing…" : "place on slide →"}
        </button>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-surface">
        <Draw
          ref={drawRef}
          board={{ w: 1_200, h: 675 }}
          background="transparent"
          initialStrokes={toDrawesome(initialLayer?.strokes ?? [])}
          onChange={(next) => setStrokes(fromDrawesome(next))}
          look="studio"
          depth="strong"
          gauge
          draggable={!narrow}
          placement={narrow ? "left" : "bottom"}
          tools={narrow ? ["pencil", "pen", "marker", "highlighter", "brush"] : undefined}
          controls={narrow ? { custom: false, opacity: false } : undefined}
          swatches={swatches}
          className="h-full w-full"
        />
      </div>
    </div>
  );
}
