import { ActionDialog } from "@/components/ActionDialog";

export interface GameActionDialogProps {
  eyebrow: string;
  title: string;
  description: string;
  error?: string | null;
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
  error,
  confirmLabel,
  cancelLabel = "cancel",
  pending = false,
  pendingLabel = "working…",
  tone,
  onCancel,
  onConfirm,
}: GameActionDialogProps) {
  return (
    <ActionDialog
      eyebrow={eyebrow}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      pending={pending}
      pendingLabel={pendingLabel}
      tone={tone}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      {error ? (
        <p role="alert" className="text-center font-mono text-xs text-[var(--things-amber)]">
          {error}
        </p>
      ) : null}
    </ActionDialog>
  );
}
