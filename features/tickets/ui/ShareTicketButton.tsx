"use client";

import { useCallback, useEffect, useState } from "react";

import { shareOrCopy } from "@/lib/client/share";
import { ticketPath } from "@/features/events/routes";

/**
 * Hand one ticket to the person it belongs to.
 *
 * A multi-ticket order lives behind the purchaser's link, so without this the
 * only way to give a guest their own QR is to screenshot it — which strands
 * them with a picture that cannot be re-scanned if the door queries it, and
 * no route back to the address or the album. Sharing the link keeps the
 * ticket a live thing.
 *
 * The URL is built at click time from the running origin: this page is only
 * ever reached at the canonical host, and reading it here avoids threading a
 * server-rendered origin through every ticket in the order.
 */

const FEEDBACK_MS = 2000;

export function ShareTicketButton({
  ticketId,
  holderName,
  eventTitle,
  className = "",
  label = "share",
}: {
  ticketId: string;
  holderName: string;
  eventTitle: string;
  className?: string;
  label?: string;
}) {
  const [feedback, setFeedback] = useState<"copied" | "failed" | null>(null);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  const share = useCallback(async () => {
    const url = `${window.location.origin}${ticketPath(ticketId)}`;
    const result = await shareOrCopy({
      url,
      title: `${holderName} — ${eventTitle}`,
      // The link is the ticket, so say so: a bare URL in a message thread
      // reads like a spam link, and this one has to survive being forwarded.
      text: `${holderName}'s ticket for ${eventTitle}. This link is the ticket — it opens the QR for the door.`,
    });
    if (result === "copied") setFeedback("copied");
    if (result === "failed") setFeedback("failed");
  }, [ticketId, holderName, eventTitle]);

  return (
    <button
      type="button"
      onClick={() => void share()}
      aria-label={`Share ${holderName}'s ticket`}
      className={`shrink-0 font-mono text-micro theme-muted hover:text-foreground transition-colors underline underline-offset-2 ${className}`}
    >
      {feedback === "copied" ? "link copied" : feedback === "failed" ? "couldn't copy" : label}
    </button>
  );
}
