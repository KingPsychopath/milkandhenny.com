import { useEffect, useState } from "react";

export type TicketMode = "scoring" | "view-only";

export function TicketScoringControl({
  ticketId,
  onModeChange,
}: {
  ticketId: string;
  onModeChange?: (mode: TicketMode) => void;
}) {
  const [active, setActive] = useState(false);
  const [anotherTicketActive, setAnotherTicketActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void fetch(`/api/tickets/${encodeURIComponent(ticketId)}/session`, {
      headers: { accept: "application/json" },
    })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as {
              mode?: TicketMode;
              active?: boolean;
              eventHasActive?: boolean;
            })
          : null,
      )
      .then((body) => {
        if (!body) return;
        const selected = body.mode === "scoring" && body.active === true;
        setActive(selected);
        setAnotherTicketActive(!selected && body.eventHasActive === true);
        onModeChange?.(selected ? "scoring" : "view-only");
      })
      .catch(() => undefined);
  }, [onModeChange, ticketId]);

  async function useForScoring() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "scoring" }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not use this ticket for points");
      setActive(true);
      setAnotherTicketActive(false);
      onModeChange?.("scoring");
      setMessage("Event points now go to this ticket.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not use this ticket for points");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t theme-border pt-4">
      {active ? (
        <p className="font-mono text-xs">Event points go to this ticket.</p>
      ) : (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => void useForScoring()}
            className="min-h-11 border theme-border-strong px-3 font-mono text-xs hover:opacity-70 disabled:opacity-50"
          >
            {busy ? "switching…" : "use this ticket for points"}
          </button>
          <p className="mt-2 font-mono text-micro theme-muted">
            {anotherTicketActive
              ? "This switches event points from your other ticket."
              : "Choose once before a game or clue can award points."}
          </p>
        </>
      )}
      {message && (
        <p role="status" className="mt-2 font-mono text-micro theme-muted">
          {message}
        </p>
      )}
    </div>
  );
}
