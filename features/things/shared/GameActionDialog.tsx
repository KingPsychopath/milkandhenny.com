import { ActionDialog } from "@/components/ActionDialog";

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
    />
  );
}
