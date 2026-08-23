import { useEffect, useRef } from "react";

export type PitchImportSummary = {
  fileName: string;
  kind: "presentation" | "backup";
  importedSlides: number;
  currentSlides: number;
  maximumSlides: number;
  embeddedMedia?: number;
};

export function PitchImportDialog({
  summary,
  onCancel,
  onConfirm,
}: {
  summary: PitchImportSummary;
  onCancel: () => void;
  onConfirm: (mode: "append" | "replace") => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canAppend =
    summary.kind === "presentation" &&
    summary.currentSlides + summary.importedSlides <= summary.maximumSlides;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="pitch-import-confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="m-auto max-h-[min(40rem,calc(100vh-3rem))] w-[min(38rem,calc(100vw-3rem))] overflow-y-auto border theme-border bg-background p-0 text-foreground backdrop:bg-foreground/20"
    >
      <header className="border-b theme-border px-6 py-5">
        <p className="font-mono text-micro uppercase tracking-[0.12em] theme-muted">
          ready to bring in
        </p>
        <h2 id="pitch-import-confirm-title" className="mt-2 font-serif text-2xl">
          {summary.kind === "backup"
            ? "Replace this working copy?"
            : "Where should these slides go?"}
        </h2>
        <p className="mt-2 break-words font-mono text-xs theme-muted">{summary.fileName}</p>
      </header>

      <div className="space-y-4 px-6 py-5">
        {summary.kind === "backup" ? (
          <p className="font-mono text-xs leading-relaxed theme-muted">
            This studio backup contains {summary.importedSlides} slide
            {summary.importedSlides === 1 ? "" : "s"}. Opening it will replace the slides and media
            currently in this studio. If you need to keep the current deck, cancel and export a
            .mahdeck copy first.
          </p>
        ) : (
          <>
            <p className="font-mono text-xs leading-relaxed theme-muted">
              We found {summary.importedSlides} slide
              {summary.importedSlides === 1 ? "" : "s"}. Text and pictures will keep their positions
              and can be moved after they arrive. Embedded video and sound will go on each slide's
              timeline{summary.embeddedMedia ? ` (${summary.embeddedMedia} found)` : ""}.
            </p>
            <p className="font-mono text-xs leading-relaxed theme-muted">
              PowerPoint transitions and object animations become static. If an exact animation is
              important, export that part as an MP4 and drop it on the timeline.
            </p>
            <p className="font-mono text-xs leading-relaxed theme-muted">
              The current studio has {summary.currentSlides} slide
              {summary.currentSlides === 1 ? "" : "s"} of {summary.maximumSlides}.
            </p>
          </>
        )}

        <div className="flex flex-wrap justify-end gap-3 border-t theme-border pt-4">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-60"
          >
            cancel
          </button>
          {summary.kind === "presentation" ? (
            <button
              type="button"
              disabled={!canAppend}
              onClick={() => onConfirm("append")}
              className="min-h-11 border theme-border-strong px-4 font-mono text-xs hover:opacity-60 disabled:cursor-not-allowed disabled:opacity-35"
            >
              add after current slides
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onConfirm("replace")}
            className="min-h-11 bg-foreground px-4 font-mono text-xs text-background hover:opacity-80"
          >
            {summary.kind === "backup" ? "open backup" : "replace current slides"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
