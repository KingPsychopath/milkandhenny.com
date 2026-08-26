import { useEffect, useMemo, useRef } from "react";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { Link } from "@tanstack/react-router";

import type {
  PitchDocument,
  PitchVersionHistoryItem,
  PitchVersionPreview,
  PitchVersionReason,
} from "../types";
import { PitchSlideThumbnail } from "./PitchSlideThumbnail";

const REASON_LABELS: Record<PitchVersionReason, string> = {
  autosave: "autosave",
  safety: "before content changed",
  conflict: "device merge",
  publish: "published edition",
  restore: "return point",
};

function when(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

function time(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

function documentSummary(document: PitchDocument) {
  const slides = document.slides.filter((slide) => !slide.deletedAt);
  return { slides, firstSlide: slides[0] };
}

function countLabel(item: Pick<PitchVersionHistoryItem, "slideCount" | "contentCount">) {
  return `${item.slideCount} slide${item.slideCount === 1 ? "" : "s"} · ${
    item.contentCount === 0
      ? "blank"
      : `${item.contentCount} content item${item.contentCount === 1 ? "" : "s"}`
  }`;
}

export function PitchVersionHistory({
  items,
  loading,
  current,
  selectedId,
  preview,
  previewLoading,
  previewError,
  files,
  deckId,
  restoringId,
  onClose,
  onSelect,
  onRestore,
}: {
  items: PitchVersionHistoryItem[];
  loading: boolean;
  current: PitchVersionHistoryItem & { document: PitchDocument };
  selectedId?: string;
  preview?: PitchVersionPreview;
  previewLoading: boolean;
  previewError: string;
  files: BinaryFiles;
  deckId: string;
  restoringId?: string;
  onClose: () => void;
  onSelect: (item?: PitchVersionHistoryItem) => void;
  onRestore: (item: PitchVersionHistoryItem) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectedItem = selectedId ? items.find((item) => item.id === selectedId) : undefined;
  const selectedDocument = selectedId
    ? preview?.item.id === selectedId
      ? preview.document
      : undefined
    : current.document;
  const summary = useMemo(
    () => (selectedDocument ? documentSummary(selectedDocument) : undefined),
    [selectedDocument],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="pitch-history-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto h-[min(48rem,calc(100vh-2rem))] w-[min(64rem,calc(100vw-2rem))] overflow-hidden border theme-border bg-background p-0 text-foreground backdrop:bg-foreground/20"
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-start justify-between gap-6 border-b theme-border px-6 py-5">
          <div>
            <p className="font-mono text-micro uppercase tracking-[0.12em] theme-muted">
              working copy · newest to oldest
            </p>
            <h2 id="pitch-history-title" className="mt-1 font-serif text-2xl">
              Version history
            </h2>
            <p className="mt-2 max-w-2xl font-mono text-micro leading-relaxed theme-muted">
              Choose a point to preview it. Restoring creates a new current version and keeps the
              version you leave as a return point.
            </p>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="min-h-11 min-w-11 shrink-0 font-mono text-xs theme-muted hover:opacity-60"
            aria-label="Close version history"
          >
            close
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(12rem,0.8fr)_minmax(0,1.2fr)] md:grid-cols-[minmax(19rem,0.85fr)_minmax(0,1.15fr)] md:grid-rows-1">
          <section
            aria-label="Version timeline"
            className="min-h-0 overflow-y-auto border-b theme-border px-5 py-5 md:border-b-0 md:border-r"
          >
            <ol className="relative ml-2 border-l theme-border pl-6">
              <li className="relative pb-7">
                <span
                  aria-hidden="true"
                  className="absolute -left-[1.82rem] top-3 h-3 w-3 rounded-full border border-[var(--things-amber)] bg-[var(--things-amber)]"
                />
                <button
                  type="button"
                  aria-current={!selectedId ? "true" : undefined}
                  onClick={() => onSelect(undefined)}
                  className={`min-h-11 w-full border px-4 py-3 text-left hover:opacity-70 ${
                    !selectedId ? "theme-border-strong bg-surface" : "theme-border"
                  }`}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs text-foreground">
                      current · v{current.version}
                    </span>
                    <span className="font-mono text-micro theme-muted">
                      {time(current.createdAt)}
                    </span>
                  </span>
                  <span className="mt-1 block font-mono text-micro theme-muted">
                    {countLabel(current)}
                  </span>
                </button>
              </li>

              {loading ? (
                <li className="relative py-6 font-mono text-xs theme-muted" role="status">
                  <span
                    aria-hidden="true"
                    className="absolute -left-[1.7rem] top-8 h-2 w-2 rounded-full bg-foreground/25"
                  />
                  loading earlier points…
                </li>
              ) : (
                items.map((item) => {
                  const selected = selectedId === item.id;
                  const published = item.reason === "publish";
                  return (
                    <li key={item.id} className="relative pb-5">
                      <span
                        aria-hidden="true"
                        className={`absolute -left-[1.7rem] top-5 h-2 w-2 rounded-full ${
                          published
                            ? "bg-[var(--things-amber)]"
                            : selected
                              ? "bg-foreground"
                              : "bg-foreground/25"
                        }`}
                      />
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => onSelect(item)}
                        className={`min-h-11 w-full border px-4 py-3 text-left hover:opacity-70 ${
                          selected ? "theme-border-strong bg-surface" : "theme-border"
                        }`}
                      >
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono text-xs text-foreground">v{item.version}</span>
                          <span className="font-mono text-micro theme-muted">
                            {when(item.createdAt)}
                          </span>
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 font-mono text-micro theme-muted">
                          <span>{REASON_LABELS[item.reason]}</span>
                          {published ? (
                            <span className="border border-[var(--things-amber)] px-1.5 py-0.5 text-foreground">
                              sealed
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 block font-mono text-micro theme-faint">
                          {countLabel(item)}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ol>
            {!loading && items.length === 0 ? (
              <p className="ml-8 border-t theme-border pt-5 font-mono text-xs leading-relaxed theme-muted">
                No earlier points yet. They appear while you work, publish, merge devices or make a
                change that removes content.
              </p>
            ) : null}
            {items.length > 0 ? (
              <p className="ml-8 pt-1 font-mono text-micro theme-faint">older versions ↓</p>
            ) : null}
          </section>

          <section aria-label="Selected version preview" className="min-h-0 overflow-y-auto p-6">
            <div className="mx-auto max-w-2xl">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-micro uppercase tracking-[0.12em] theme-muted">
                    {!selectedItem
                      ? "you are here"
                      : selectedItem.reason === "restore"
                        ? "safe return point"
                        : REASON_LABELS[selectedItem.reason]}
                  </p>
                  <h3 className="mt-1 font-serif text-2xl text-foreground">
                    {!selectedItem
                      ? `Current version · v${current.version}`
                      : `Version ${selectedItem.version}`}
                  </h3>
                  <p className="mt-1 font-mono text-xs theme-muted">
                    {when(selectedItem?.createdAt ?? current.createdAt)}
                  </p>
                  <p className="mt-1 font-serif text-base theme-muted">
                    {selectedItem?.title ?? current.title}
                  </p>
                </div>
                {selectedItem ? (
                  <div className="flex flex-wrap gap-3">
                    {typeof selectedItem.metadata.editionNumber === "number" ? (
                      <Link
                        to="/things/pitches/$deckId"
                        params={{ deckId }}
                        search={{ edition: selectedItem.metadata.editionNumber }}
                        className="inline-flex min-h-11 items-center border theme-border-strong px-4 font-mono text-xs text-foreground hover:opacity-70"
                      >
                        open sealed edition {selectedItem.metadata.editionNumber}
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      disabled={Boolean(restoringId) || previewLoading || !selectedDocument}
                      onClick={() => onRestore(selectedItem)}
                      className="min-h-11 bg-foreground px-4 font-mono text-xs text-background hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      {restoringId === selectedItem.id ? "restoring…" : "restore as current"}
                    </button>
                  </div>
                ) : (
                  <span className="border theme-border-strong px-3 py-2 font-mono text-micro text-foreground">
                    current
                  </span>
                )}
              </div>

              {previewLoading ? (
                <div
                  className="mt-8 aspect-video animate-pulse bg-surface motion-reduce:animate-none"
                  role="status"
                >
                  <span className="sr-only">loading version preview…</span>
                </div>
              ) : previewError ? (
                <div
                  className="mt-8 flex aspect-video items-center justify-center border theme-border bg-surface px-6 text-center font-mono text-xs theme-muted"
                  role="alert"
                >
                  {previewError}
                </div>
              ) : summary?.firstSlide ? (
                <div className="mt-8 overflow-hidden border theme-border bg-surface">
                  <PitchSlideThumbnail
                    slide={summary.firstSlide}
                    files={files}
                    alt={`Preview of ${summary.firstSlide.name}`}
                    className="aspect-video w-full object-contain"
                  />
                </div>
              ) : (
                <div className="mt-8 flex aspect-video items-center justify-center border theme-border bg-surface px-6 text-center font-mono text-xs theme-muted">
                  {selectedItem ? "This version is blank." : "The current version is blank."}
                </div>
              )}

              {summary ? (
                <div className="mt-6 border-t theme-border pt-5">
                  <p className="font-mono text-xs text-foreground">
                    {summary.slides.length} slide{summary.slides.length === 1 ? "" : "s"}
                  </p>
                  <ol className="mt-3 divide-y theme-border">
                    {summary.slides.map((slide, index) => (
                      <li key={slide.id} className="flex gap-4 py-3 font-mono text-xs">
                        <span className="theme-faint">{String(index + 1).padStart(2, "0")}</span>
                        <span className="min-w-0 truncate text-foreground">{slide.name}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}

              {selectedItem ? (
                <p className="mt-6 border-t theme-border pt-5 font-mono text-micro leading-relaxed theme-muted">
                  Restoring does not erase later work. The current version is saved first, then this
                  copy becomes a new current version.
                </p>
              ) : (
                <p className="mt-6 border-t theme-border pt-5 font-mono text-micro leading-relaxed theme-muted">
                  Earlier points are below. Published editions use the amber marker. The last 10
                  published editions have a separate retained history allowance.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </dialog>
  );
}
