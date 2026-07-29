"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";

export interface GuidedTourStep {
  id: string;
  selector: string;
  title: string;
  body: string;
  side?: "top" | "right" | "bottom" | "left";
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function visibleTarget(selector: string): Element | null {
  return (
    [...document.querySelectorAll(selector)].find((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none";
    }) ?? null
  );
}

function targetRect(target: Element): Rect {
  const source = target.getBoundingClientRect();
  const space = innerWidth < 640 ? 7 : 10;
  const left = Math.max(8, source.left - space);
  const top = Math.max(8, source.top - space);
  const right = Math.min(innerWidth - 8, source.right + space);
  const bottom = Math.min(innerHeight - 8, source.bottom + space);
  return {
    top,
    left,
    width: Math.max(44, right - left),
    height: Math.max(44, bottom - top),
  };
}

function cardPosition(rect: Rect, preferred: GuidedTourStep["side"]) {
  const width = Math.min(360, innerWidth - 32);
  const height = 250;
  const gap = 14;
  const choices = [preferred ?? "bottom", "bottom", "top", "right", "left"] as const;
  for (const side of new Set(choices)) {
    const raw =
      side === "top"
        ? { top: rect.top - height - gap, left: rect.left + rect.width / 2 - width / 2 }
        : side === "bottom"
          ? { top: rect.top + rect.height + gap, left: rect.left + rect.width / 2 - width / 2 }
          : side === "right"
            ? { top: rect.top + rect.height / 2 - height / 2, left: rect.left + rect.width + gap }
            : { top: rect.top + rect.height / 2 - height / 2, left: rect.left - width - gap };
    if (
      raw.top >= 16 &&
      raw.left >= 16 &&
      raw.top + height <= innerHeight - 16 &&
      raw.left + width <= innerWidth - 16
    ) {
      return { ...raw, width };
    }
  }
  return {
    top: Math.max(16, innerHeight - height - 16),
    left: Math.max(16, (innerWidth - width) / 2),
    width,
  };
}

export function GuidedTour({
  open,
  steps,
  onClose,
  onComplete,
}: {
  open: boolean;
  steps: readonly GuidedTourStep[];
  onClose: () => void;
  onComplete?: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect>();
  const step = steps[index];

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const sync = useCallback(() => {
    if (!step) return;
    const target = visibleTarget(step.selector);
    if (target) setRect(targetRect(target));
  }, [step]);

  useEffect(() => {
    if (!open || !step) return;
    const target = visibleTarget(step.selector);
    target?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    let frame = 0;
    let attempts = 0;
    const settle = () => {
      sync();
      attempts += 1;
      if (attempts < 30) frame = requestAnimationFrame(settle);
    };
    frame = requestAnimationFrame(settle);
    requestAnimationFrame(() => cardRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, step, sync]);

  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight")
        setIndex((current) => Math.min(steps.length - 1, current + 1));
      if (event.key === "ArrowLeft") setIndex((current) => Math.max(0, current - 1));
    };
    addEventListener("keydown", keydown);
    addEventListener("resize", sync);
    addEventListener("scroll", sync, true);
    return () => {
      removeEventListener("keydown", keydown);
      removeEventListener("resize", sync);
      removeEventListener("scroll", sync, true);
    };
  }, [onClose, open, steps.length, sync]);

  if (!mounted || !open || !step || !rect) return null;
  const position = cardPosition(rect, step.side);
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const panels = [
    { id: "top", top: 0, left: 0, width: innerWidth, height: rect.top },
    {
      id: "bottom",
      top: bottom,
      left: 0,
      width: innerWidth,
      height: Math.max(0, innerHeight - bottom),
    },
    { id: "left", top: rect.top, left: 0, width: rect.left, height: rect.height },
    {
      id: "right",
      top: rect.top,
      left: right,
      width: Math.max(0, innerWidth - right),
      height: rect.height,
    },
  ];
  const last = index === steps.length - 1;

  return createPortal(
    <div
      className="guided-tour-shell fixed inset-0 z-[110]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guided-tour-title"
    >
      {panels.map(({ id, ...panel }) => (
        <div
          key={id}
          className="guided-tour-mask fixed bg-foreground/55 backdrop-blur-[1px]"
          style={panel}
        />
      ))}
      <div
        data-guided-tour-spotlight="true"
        className="guided-tour-spotlight pointer-events-none fixed border-2 border-background shadow-lg"
        style={rect}
      />
      <div
        ref={cardRef}
        tabIndex={-1}
        className="guided-tour-card fixed border theme-border bg-background p-5 text-foreground shadow-2xl outline-none"
        style={position}
      >
        <div key={step.id} className="guided-tour-step">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-micro uppercase tracking-[0.14em] theme-muted">
                {index + 1} / {steps.length}
              </p>
              <h2 id="guided-tour-title" className="mt-1 font-serif text-2xl">
                {step.title}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 min-w-11 font-mono text-sm theme-muted"
              aria-label="Close tutorial"
            >
              ×
            </button>
          </div>
          <p className="mt-3 font-serif leading-relaxed theme-muted">{step.body}</p>
          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => setIndex((current) => Math.max(0, current - 1))}
              className="min-h-11 px-3 font-mono text-xs theme-muted disabled:opacity-25"
            >
              ← back
            </button>
            <button
              type="button"
              onClick={() => {
                if (last) {
                  onComplete?.();
                  onClose();
                } else {
                  setIndex((current) => current + 1);
                }
              }}
              className="min-h-11 bg-foreground px-5 font-mono text-xs text-background"
            >
              {last ? "start making →" : "next →"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
