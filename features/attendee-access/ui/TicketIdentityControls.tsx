import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import type { AttendeeAccount } from "../types";

export function TicketIdentityControls({ ticketId }: { ticketId: string }) {
  const [account, setAccount] = useState<AttendeeAccount | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [inAppBrowser, setInAppBrowser] = useState(false);

  useEffect(() => {
    setInAppBrowser(
      /FBAN|FBAV|Instagram|Line\/|LinkedInApp|TikTok|Snapchat|Twitter/i.test(navigator.userAgent),
    );
    void fetch("/api/attendee/session", { headers: { accept: "application/json" } })
      .then(async (response) =>
        response.ok ? ((await response.json()) as { account?: AttendeeAccount | null }) : null,
      )
      .then((body) => setAccount(body?.account ?? null))
      .finally(() => setLoaded(true));
  }, []);

  const personallyClaimed = account?.tickets.some(
    (ticket) => ticket.id === ticketId && ticket.personallyClaimed,
  );

  async function claim() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/identity`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "This ticket could not be claimed");
      setMessage("This ticket is now saved to You across devices.");
      setAccount(
        account
          ? {
              ...account,
              tickets: account.tickets.some((ticket) => ticket.id === ticketId)
                ? account.tickets.map((ticket) =>
                    ticket.id === ticketId ? { ...ticket, personallyClaimed: true } : ticket,
                  )
                : account.tickets,
            }
          : null,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This ticket could not be claimed");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;
  return (
    <section aria-label="Keep this ticket across devices" className="mt-3">
      {personallyClaimed ? (
        <p className="font-mono text-micro theme-muted">
          saved to You{account?.name ? ` as ${account.name}` : ""} ·{" "}
          <Link to="/my" className="inline-flex min-h-11 items-center underline hover:opacity-70">
            manage
          </Link>
        </p>
      ) : account ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void claim()}
          className="min-h-11 py-3 font-mono text-micro theme-muted underline hover:opacity-70 disabled:opacity-50"
        >
          {busy ? "connecting…" : "save this ticket to You"}
        </button>
      ) : (
        <p className="font-mono text-micro theme-muted">
          save this ticket across devices ·{" "}
          <Link
            to="/access"
            search={{ returnTo: `/ticket/${ticketId}` }}
            className="inline-flex min-h-11 items-center underline hover:opacity-70"
          >
            verify your email
          </Link>
        </p>
      )}
      {message && (
        <p role="status" className="mt-3 font-mono text-xs theme-muted">
          {message}
        </p>
      )}
      {inAppBrowser && (
        <p className="mt-2 font-mono text-micro theme-muted">
          using an in-app browser?{" "}
          <a
            href={window.location.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center underline hover:opacity-70"
          >
            open in Safari or Chrome
          </a>{" "}
          for more reliable access
        </p>
      )}
    </section>
  );
}
