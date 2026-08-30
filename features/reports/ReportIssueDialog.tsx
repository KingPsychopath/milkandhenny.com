"use client";

import { useEffect, useId, useRef } from "react";

type DialogStatus = "idle" | "saving" | "error";

export function ReportIssueDialog({
  detailRequired,
  value,
  status,
  errorMessage,
  onChange,
  onCancel,
  onSubmit,
}: {
  detailRequired: boolean;
  value: string;
  status: DialogStatus;
  errorMessage: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const fieldId = useId();
  const helpId = useId();
  const errorId = useId();
  const saving = status === "saving";

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const cancel = () => {
    if (!saving) onCancel();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) cancel();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(38rem,calc(100vw-2rem))] overflow-y-auto border theme-border bg-background p-0 text-foreground backdrop:bg-foreground/20"
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <header className="border-b theme-border px-6 py-5">
          <p className="font-mono text-micro uppercase tracking-[0.12em] theme-muted">
            report an issue
          </p>
          <h2 id={titleId} className="mt-2 font-serif text-2xl">
            What went wrong?
          </h2>
          <p id={descriptionId} className="mt-2 font-mono text-xs leading-relaxed theme-muted">
            {detailRequired
              ? "Tell us what happened and what you expected. We’ll attach technical details from this page automatically."
              : "We’ve already captured the relevant technical details. Add anything else you noticed, or send the report as it is."}
          </p>
        </header>

        <div className="space-y-4 px-6 py-5">
          <label htmlFor={fieldId} className="block font-mono text-xs theme-muted">
            What did you notice?{detailRequired ? "" : " (optional)"}
            <textarea
              id={fieldId}
              autoFocus
              required={detailRequired}
              aria-required={detailRequired}
              aria-invalid={Boolean(errorMessage)}
              aria-describedby={`${helpId}${errorMessage ? ` ${errorId}` : ""}`}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              maxLength={1_000}
              placeholder="I tried to … but instead …"
              className="mt-2 block min-h-36 w-full resize-y border theme-border-strong bg-transparent p-3 font-mono text-sm text-foreground outline-none placeholder:theme-muted focus:border-foreground"
            />
          </label>

          <div className="flex items-start justify-between gap-4">
            <p id={helpId} className="font-mono text-micro theme-faint">
              {value.length}/1,000
            </p>
            {errorMessage ? (
              <p id={errorId} role="alert" className="text-right font-mono text-micro theme-muted">
                {errorMessage}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap justify-end gap-3 border-t theme-border pt-4">
            <button
              type="button"
              disabled={saving}
              onClick={cancel}
              className="mh-action mh-action--secondary disabled:opacity-50"
            >
              cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="mh-action mh-action--primary disabled:opacity-50"
            >
              {saving ? "sending report…" : "send report"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
