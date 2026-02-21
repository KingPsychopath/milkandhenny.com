"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSwipe } from "@/hooks/useSwipe";
import type { MediaPreviewItem } from "../types";

type MediaPreviewModalProps = {
  items: MediaPreviewItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
};

export function MediaPreviewModal({
  items,
  index,
  onClose,
  onIndexChange,
}: MediaPreviewModalProps) {
  const [previewError, setPreviewError] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);

  const current = useMemo(() => items[index] ?? null, [index, items]);
  const canNavigate = items.length > 1;
  const hasPrev = canNavigate && index > 0;
  const hasNext = canNavigate && index < items.length - 1;

  const showPrev = useCallback(() => {
    if (!hasPrev) return;
    onIndexChange(index - 1);
  }, [hasPrev, index, onIndexChange]);

  const showNext = useCallback(() => {
    if (!hasNext) return;
    onIndexChange(index + 1);
  }, [hasNext, index, onIndexChange]);

  useEffect(() => {
    setPreviewError(false);
    setPreviewLoaded(false);
  }, [index]);

  const swipeRef = useSwipe<HTMLDivElement>({
    onSwipeLeft: hasNext ? showNext : undefined,
    onSwipeRight: hasPrev ? showPrev : undefined,
    enabled: !!current && canNavigate,
  });

  useEffect(() => {
    if (!current) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (canNavigate && event.key === "ArrowRight") showNext();
      if (canNavigate && event.key === "ArrowLeft") showPrev();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canNavigate, current, onClose, showNext, showPrev]);

  useEffect(() => {
    if (!current) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [current]);

  if (!current) return null;

  return (
    <div
      ref={swipeRef}
      className="fixed inset-0 z-50 bg-black/90 px-4 py-6 flex flex-col items-center justify-center touch-pan-y"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 z-10 font-mono text-sm text-white/70 hover:text-white transition-colors"
        aria-label="Close media preview"
      >
        ✕
      </button>

      <div
        className="w-full max-w-5xl flex items-center justify-center min-h-0"
        onClick={(event) => event.stopPropagation()}
      >
        {current.kind === "video" ? (
          <video
            src={current.url}
            controls
            autoPlay
            className="max-w-full max-h-[78vh] rounded-sm"
            onError={() => setPreviewError(true)}
          />
        ) : current.kind === "audio" ? (
          <div className="w-full max-w-xl border border-white/20 rounded-md p-4 space-y-3">
            <p className="font-mono text-xs text-white/80 truncate">{current.filename}</p>
            <audio src={current.url} controls className="w-full" onError={() => setPreviewError(true)} />
          </div>
        ) : current.kind === "file" ? (
          <div className="w-full max-w-xl border border-white/20 rounded-md p-4 space-y-3 text-center">
            <p className="font-mono text-xs text-white/80">{current.filename}</p>
            <p className="font-mono text-micro text-white/50">this file type cannot be previewed inline</p>
            <a
              href={current.url}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs underline text-white/80"
            >
              open file
            </a>
          </div>
        ) : previewError ? (
          <div className="w-full max-w-xl border border-white/20 rounded-md p-4 space-y-3 text-center">
            <p className="font-mono text-xs text-white/80">failed to load {current.filename}</p>
            <a
              href={current.url}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs underline text-white/80"
            >
              open in new tab
            </a>
          </div>
        ) : (
          <div className="relative">
            {!previewLoaded ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="font-mono text-micro text-white/50 animate-pulse">loading...</span>
              </div>
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.url}
              alt={current.filename}
              className={`max-w-full max-h-[78vh] rounded-sm object-contain transition-opacity ${
                previewLoaded ? "opacity-100" : "opacity-0"
              }`}
              onLoad={() => setPreviewLoaded(true)}
              onError={() => setPreviewError(true)}
            />
          </div>
        )}
      </div>

      <div
        className="w-full max-w-4xl mt-4 flex flex-wrap items-center justify-between gap-3 px-1 font-mono text-xs text-white/70"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-4">
          {canNavigate ? (
            <>
              {hasPrev ? (
                <button type="button" onClick={showPrev} className="hover:text-white transition-colors">
                  ← prev
                </button>
              ) : null}
              {hasNext ? (
                <button type="button" onClick={showNext} className="hover:text-white transition-colors">
                  next →
                </button>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-4">
          {canNavigate ? <span className="text-white/40">{index + 1} / {items.length}</span> : null}
          <a href={current.url} target="_blank" rel="noreferrer" className="hover:text-white transition-colors">
            open ↗
          </a>
        </div>
      </div>
    </div>
  );
}
