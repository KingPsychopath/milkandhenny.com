import { useState } from "react";
import { GameActionDialog } from "./GameActionDialog";

interface GiveUpControlProps {
  tone: "light" | "dark";
  description: string;
  disabled?: boolean;
  className?: string;
  title?: string;
  onGiveUp: () => Promise<boolean> | boolean;
}

/** Opt-in give-up affordance for games that can safely abandon a round. */
export function GiveUpControl({
  tone,
  description,
  disabled = false,
  className,
  title = "Give up?",
  onGiveUp,
}: GiveUpControlProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    setPending(true);
    try {
      if (await onGiveUp()) setOpen(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled || pending}
        onClick={() => setOpen(true)}
      >
        give up
      </button>
      {open ? (
        <GameActionDialog
          tone={tone}
          eyebrow="give up"
          title={title}
          description={description}
          cancelLabel="keep playing"
          confirmLabel="give up"
          pending={pending}
          pendingLabel="giving up…"
          onCancel={() => {
            if (!pending) setOpen(false);
          }}
          onConfirm={() => void confirm()}
        />
      ) : null}
    </>
  );
}
