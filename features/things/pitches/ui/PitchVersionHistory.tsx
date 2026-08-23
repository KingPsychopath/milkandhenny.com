import { useEffect, useRef } from "react";

import type { PitchVersionHistoryItem, PitchVersionReason } from "../types";

const REASON_LABELS: Record<PitchVersionReason, string> = {
  autosave: "autosave",
  safety: "before content changed",
  conflict: "device merge",
  publish: "published edition",
  restore: "before a restore",
};

function when(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function PitchVersionHistory({
  items,
  loading,
  restoringId,
  onClose,
  onRestore,
}: {
  items: PitchVersionHistoryItem[];
  loading: boolean;
  restoringId?: string;
  onClose: () => void;
  onRestore: (item: PitchVersionHistoryItem) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

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
      className="m-auto max-h-[min(42rem,calc(100vh-3rem))] w-[min(38rem,calc(100vw-3rem))] overflow-y-auto border theme-border bg-background p-0 text-foreground backdrop:bg-foreground/20"
    >
      <header className="sticky top-0 flex items-start justify-between gap-6 border-b theme-border bg-background px-6 py-5">
        <div>
          <h2 id="pitch-history-title" className="font-serif text-2xl">
            Version history
          </h2>
          <p className="mt-2 max-w-lg font-mono text-micro leading-relaxed theme-muted">
            The latest 20 useful checkpoints are kept. Restoring saves your current version first,
            so you can move back to it later.
          </p>
        </div>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="min-h-11 min-w-11 font-mono text-sm theme-muted hover:opacity-60"
          aria-label="Close version history"
        >
          close
        </button>
      </header>

      <div className="px-6 py-3">
        {loading ? (
          <p className="py-8 font-mono text-xs theme-muted" role="status">
            loading restore points…
          </p>
        ) : items.length > 0 ? (
          <ol className="divide-y theme-border">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-5 py-4">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-foreground">{when(item.createdAt)}</p>
                  <p className="mt-1 font-mono text-micro theme-muted">
                    v{item.version} · {REASON_LABELS[item.reason]} · {item.slideCount} slide
                    {item.slideCount === 1 ? "" : "s"} · {item.contentCount || "blank"} content
                    {item.contentCount === 1 ? " item" : item.contentCount > 1 ? " items" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={Boolean(restoringId)}
                  onClick={() => onRestore(item)}
                  className="min-h-11 shrink-0 border-b theme-border-strong px-2 font-mono text-xs hover:opacity-60 disabled:opacity-35"
                >
                  {restoringId === item.id ? "restoring…" : "restore"}
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-8 font-mono text-xs theme-muted">
            No restore points yet. They appear during autosaving, publishing and safety saves.
          </p>
        )}
      </div>
    </dialog>
  );
}
