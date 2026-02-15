"use client";

import { useState, useCallback } from "react";

type TakedownButtonProps = {
  transferId: string;
  deleteToken: string;
};

/**
 * Admin-only button to permanently take down a transfer.
 * Only rendered when the URL contains a valid ?token= parameter.
 * Shows a confirmation step before executing.
 */
export function TakedownButton({ transferId, deleteToken }: TakedownButtonProps) {
  const [state, setState] = useState<"idle" | "confirm" | "deleting" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleTakedown = useCallback(async () => {
    setState("deleting");
    setErrorMsg("");

    try {
      const res = await fetch(`/api/transfers/${transferId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: deleteToken }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message =
          res.status === 403
            ? "Invalid or expired delete token. Refresh and try again."
            : res.status === 404
              ? "Transfer not found or already expired."
              : (data.error as string) || "Takedown failed. Please try again.";
        setErrorMsg(message);
        setState("error");
        return;
      }

      setState("done");
    } catch {
      setErrorMsg("Connection error. Check your network and try again.");
      setState("error");
    }
  }, [transferId, deleteToken]);

  if (state === "done") {
    return (
      <div className="transfer-takedown-done">
        <p className="font-mono text-sm text-red-500 tracking-tight">
          transfer taken down
        </p>
        <p className="font-mono text-[11px] theme-muted mt-1">
          all files have been permanently deleted.
        </p>
      </div>
    );
  }

  if (state === "confirm") {
    return (
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] text-red-500">
          permanently delete this transfer?
        </span>
        <button
          onClick={handleTakedown}
          className="font-mono text-[11px] text-red-500 hover:text-red-400 transition-colors tracking-wide"
        >
          [ yes, take down ]
        </button>
        <button
          onClick={() => setState("idle")}
          className="font-mono text-[11px] theme-muted hover:text-foreground transition-colors tracking-wide"
        >
          [ cancel ]
        </button>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] text-red-500">
          error: {errorMsg}
        </span>
        <button
          onClick={() => setState("idle")}
          className="font-mono text-[11px] theme-muted hover:text-foreground transition-colors tracking-wide"
        >
          [ dismiss ]
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setState("confirm")}
      disabled={state === "deleting"}
      className="font-mono text-[11px] text-red-500/70 hover:text-red-500 transition-colors tracking-wide disabled:opacity-50"
    >
      {state === "deleting" ? "[ taking down... ]" : "[ take down transfer ]"}
    </button>
  );
}
