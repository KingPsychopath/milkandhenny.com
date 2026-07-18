"use client";

import type { ReactNode } from "react";
import { useId } from "react";
import { createPortal } from "react-dom";

import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useHasMounted } from "@/hooks/useHasMounted";

export interface ActionDialogProps {
  title: string;
  description?: ReactNode;
  eyebrow?: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  pending?: boolean;
  pendingLabel?: string;
  intent?: "default" | "danger";
  tone?: "site" | "light" | "dark";
  onCancel: () => void;
  onConfirm: () => void;
}

export function ActionDialog({
  title,
  description,
  eyebrow,
  children,
  confirmLabel,
  cancelLabel = "cancel",
  confirmDisabled = false,
  pending = false,
  pendingLabel = "working…",
  intent = "default",
  tone = "site",
  onCancel,
  onConfirm,
}: ActionDialogProps) {
  const dialogRef = useFocusTrap<HTMLFormElement>(true);
  const titleId = useId();
  const descriptionId = useId();
  const mounted = useHasMounted();
  useEscapeKey(onCancel, !pending);

  const surface =
    tone === "light"
      ? "border-transparent bg-[var(--things-cream)] text-black"
      : tone === "dark"
        ? "border-white/12 bg-[var(--things-night)] text-white"
        : "theme-border bg-background text-foreground";
  const muted =
    tone === "light" ? "text-black/55" : tone === "dark" ? "text-white/55" : "theme-muted";
  const cancel =
    tone === "light"
      ? "border-black/20"
      : tone === "dark"
        ? "border-white/20"
        : "theme-border";
  const confirm =
    intent === "danger"
      ? "bg-red-700 text-white"
      : tone === "light"
        ? "bg-black text-white"
        : tone === "dark"
          ? "bg-white text-black"
          : "bg-[var(--foreground)] text-[var(--background)]";

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/55 p-4 backdrop-blur-sm sm:items-center">
      {/* react-doctor-disable-next-line prefer-html-dialog -- shared hooks trap focus, handle Escape, and restore the trigger */}
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        noValidate
        className={`w-full max-w-md rounded-[2rem] border p-6 text-center shadow-2xl ${surface}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending && !confirmDisabled) onConfirm();
        }}
      >
        {eyebrow ? (
          <p className={`font-mono text-micro uppercase tracking-[0.18em] ${muted}`}>
            {eyebrow}
          </p>
        ) : null}
        <h2 id={titleId} className={`${eyebrow ? "mt-3" : ""} font-serif text-4xl font-semibold`}>
          {title}
        </h2>
        {description ? (
          <div id={descriptionId} className={`mt-3 font-serif text-base ${muted}`}>
            {description}
          </div>
        ) : null}
        {children ? <div className="mt-6 text-left">{children}</div> : null}
        <div className="mt-7 grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={onCancel}
            className={`min-h-14 rounded-full border px-4 font-mono text-sm font-semibold disabled:opacity-40 ${cancel}`}
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            disabled={pending || confirmDisabled}
            className={`min-h-14 rounded-full px-4 font-mono text-sm font-semibold disabled:opacity-40 ${confirm}`}
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
