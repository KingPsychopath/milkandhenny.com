import { GameActionDialog, type GameActionDialogProps } from "./GameActionDialog";

type EndGameDialogProps = Omit<GameActionDialogProps, "pendingLabel">;

export function EndGameDialog({
  eyebrow,
  title,
  description,
  confirmLabel,
  cancelLabel = "keep playing",
  pending = false,
  tone,
  onCancel,
  onConfirm,
}: EndGameDialogProps) {
  return (
    <GameActionDialog
      eyebrow={eyebrow}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      pending={pending}
      pendingLabel="ending…"
      tone={tone}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
