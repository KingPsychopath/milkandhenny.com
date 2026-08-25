"use client";

import { useState } from "react";

import { refundOwnTicketFn } from "../tickets.functions";
import { formatMoney } from "@/features/events/types";

/**
 * Self-serve refund.
 *
 * Refunds the selected ticket allocation and leaves sibling tickets alone.
 * Refunds after check-in are refused server-side and left to a conversation,
 * because the door record is the evidence either way.
 */
export function RefundTicketButton({
  ticketId,
  amountMinor,
  currency,
  disabledReason,
}: {
  ticketId: string;
  amountMinor?: number;
  currency?: string;
  /** Set when a refund is not offered, e.g. already scanned or doors open. */
  disabledReason?: string;
}) {
  const [state, setState] = useState<
    "idle" | "confirming" | "working" | "consent-pending" | "pending" | "done" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const [emailQueued, setEmailQueued] = useState(false);

  if (disabledReason) {
    return (
      <p className="text-center font-mono text-micro theme-muted leading-relaxed">
        {disabledReason}
      </p>
    );
  }

  if (state === "done") {
    return (
      <p className="text-center font-mono text-micro theme-subtle leading-relaxed">
        Refunded.{" "}
        {emailQueued
          ? "Your confirmation email is queued."
          : "The confirmation email could not be queued, so keep this page as your record."}{" "}
        It usually lands back within a few working days, and this QR no longer works at the door.
      </p>
    );
  }

  if (state === "pending") {
    return (
      <p role="status" className="text-center font-mono text-micro theme-subtle leading-relaxed">
        Stripe is processing the refund. This ticket is cancelled now. We will email the
        confirmation after the money has been returned.
      </p>
    );
  }

  if (state === "consent-pending") {
    return (
      <p role="status" className="text-center font-mono text-micro theme-subtle leading-relaxed">
        The current holder must consent before the refund starts.
        {emailQueued ? " We emailed their one-time link." : " The email needs admin attention."}
      </p>
    );
  }

  const amount =
    amountMinor !== undefined && currency ? formatMoney(amountMinor, currency) : "this ticket";
  const ticketLabel = "this ticket";

  const submit = async () => {
    setState("working");
    try {
      const result = await refundOwnTicketFn({ data: { ticketId } });
      if (!result.ok) {
        setMessage(result.error);
        setState("error");
        return;
      }
      if (result.state === "pending") {
        setState("pending");
        return;
      }
      if (result.state === "consent-pending") {
        setEmailQueued(result.emailQueued);
        setState("consent-pending");
        return;
      }
      setEmailQueued(result.emailQueued);
      setState("done");
    } catch {
      setMessage("That didn't work. Try again, or message us.");
      setState("error");
    }
  };

  return (
    <div className="text-center">
      {state === "confirming" ? (
        <div className="space-y-2">
          <p className="font-mono text-micro theme-subtle">
            Refund {amount} and cancel {ticketLabel}?
          </p>
          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={() => void submit()}
              className="min-h-10 rounded-lg border theme-border-strong px-4 font-mono text-xs text-foreground"
            >
              yes, refund
            </button>
            <button
              type="button"
              onClick={() => setState("idle")}
              className="min-h-10 px-3 font-mono text-xs theme-muted hover:text-foreground transition-colors"
            >
              keep it
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={state === "working"}
          onClick={() => setState("confirming")}
          className="min-h-10 font-mono text-micro theme-muted underline hover:text-foreground transition-colors disabled:opacity-50"
        >
          {state === "working" ? "refunding…" : "can't make it? refund this ticket"}
        </button>
      )}

      {state === "error" && (
        <p role="alert" className="mt-2 font-mono text-micro theme-subtle leading-relaxed">
          {message}
        </p>
      )}
    </div>
  );
}
