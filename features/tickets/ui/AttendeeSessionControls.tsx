import { useEffect, useState } from "react";

export function AttendeeSessionControls({ ticketId }: { ticketId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [inAppBrowser, setInAppBrowser] = useState(false);

  useEffect(() => {
    setInAppBrowser(
      /FBAN|FBAV|Instagram|Line\/|LinkedInApp|TikTok|Snapchat|Twitter/i.test(navigator.userAgent),
    );
  }, []);

  async function update(method: "POST" | "PATCH" | "DELETE", mode?: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/session`, {
        method,
        headers: mode ? { "content-type": "application/json" } : undefined,
        body: mode ? JSON.stringify({ mode }) : undefined,
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not update this device");
      setMessage(
        method === "DELETE"
          ? "Removed from this device. The ticket and score are unchanged."
          : mode === "managed"
            ? "You are managing this ticket on this device."
            : mode === "view-only"
              ? "This ticket is view-only on this device."
              : "This ticket is selected for event scoring.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update this device");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="ticket-device-heading" className="mt-8 border-y theme-border py-4">
      <h2
        id="ticket-device-heading"
        className="font-mono text-micro uppercase tracking-widest theme-muted"
      >
        this device
      </h2>
      <p className="mt-2 font-serif text-lg">How are you using this ticket?</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void update("POST", "personal")}
          className="min-h-11 border theme-border px-3 font-mono text-xs hover:opacity-70 disabled:opacity-50"
        >
          this is my ticket
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void update("POST", "managed")}
          className="min-h-11 border theme-border px-3 font-mono text-xs hover:opacity-70 disabled:opacity-50"
        >
          I manage this ticket
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void update("POST", "view-only")}
          className="min-h-11 border theme-border px-3 font-mono text-xs hover:opacity-70 disabled:opacity-50"
        >
          view only
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void update("PATCH")}
          className="min-h-11 border theme-border px-3 font-mono text-xs hover:opacity-70 disabled:opacity-50"
        >
          switch to this ticket
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void update("DELETE")}
          className="min-h-11 border theme-border px-3 font-mono text-xs hover:opacity-70 disabled:opacity-50"
        >
          this is not me · remove
        </button>
      </div>
      <p className="mt-3 font-mono text-micro theme-muted">
        Private browsing can forget this choice. Keep the ticket link so you can recover access.
      </p>
      {inAppBrowser && (
        <div className="mt-3 font-mono text-xs theme-muted">
          <p>
            This is an in-app browser. Open the link in Safari or Chrome so the ticket choice
            persists.
          </p>
          <a
            href={window.location.href}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block min-h-11 py-3 underline hover:opacity-70"
          >
            open in browser
          </a>
        </div>
      )}
      <button
        type="button"
        onClick={() => void navigator.clipboard.writeText(window.location.href)}
        className="mt-3 min-h-11 font-mono text-xs underline hover:opacity-70"
      >
        copy ticket link
      </button>
      <p className="mt-2 font-mono text-micro theme-muted">
        Anyone with this link or a screenshot can open the ticket. Share it only with the ticket
        holder.
      </p>
      {message && (
        <p role="status" className="mt-3 font-mono text-xs theme-muted">
          {message}
        </p>
      )}
    </section>
  );
}
