import { useId } from "react";

import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useFocusTrap } from "@/hooks/useFocusTrap";

export interface GameActionDialogProps {
  eyebrow: string;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  pendingLabel?: string;
  tone: "light" | "dark";
  onCancel: () => void;
  onConfirm: () => void;
}

export function GameActionDialog({
  eyebrow,
  title,
  description,
  confirmLabel,
  cancelLabel = "cancel",
  pending = false,
  pendingLabel = "working…",
  tone,
  onCancel,
  onConfirm,
}: GameActionDialogProps) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  const titleId = useId();
  const descriptionId = useId();
  useEscapeKey(onCancel, !pending);
  const light = tone === "light";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-4 backdrop-blur-sm sm:items-center">
      {/* react-doctor-disable-next-line prefer-html-dialog -- shared hooks trap focus, handle Escape, and restore the trigger */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={`w-full max-w-md rounded-[2rem] p-6 text-center shadow-2xl ${light ? "bg-[var(--things-cream)] text-black" : "border border-white/12 bg-[var(--things-night)] text-white"}`}
      >
        <p
          className={`font-mono text-micro uppercase tracking-[0.18em] ${light ? "text-black/50" : "text-white/45"}`}
        >
          {eyebrow}
        </p>
        <h2 id={titleId} className="mt-3 font-serif text-4xl font-semibold">
          {title}
        </h2>
        <p
          id={descriptionId}
          className={`mt-3 font-serif text-base ${light ? "text-black/60" : "text-white/60"}`}
        >
          {description}
        </p>
        <div className="mt-7 grid grid-cols-2 gap-3">
          <button
            type="button"
            autoFocus
            disabled={pending}
            onClick={onCancel}
            className={`min-h-14 rounded-full border px-4 font-mono text-sm font-semibold disabled:opacity-40 ${light ? "border-black/20" : "border-white/20"}`}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className={`min-h-14 rounded-full px-4 font-mono text-sm font-semibold disabled:opacity-50 ${light ? "bg-black text-white" : "bg-white text-black"}`}
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
