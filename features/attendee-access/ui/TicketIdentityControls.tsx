import { FormEvent, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import { EmailAddressNotice } from "@/components/EmailAddressNotice";
import { sendTicketOperationFn } from "@/features/attendee-operations/ticket-operations.functions";
import type { AttendeeAccount, AttendeeTicketIdentity } from "../types";
import { claimTicketIdentityFn } from "../ticket-identity.functions";

export function TicketIdentityControls({
  ticketId,
  canManageOrder,
  initialIdentity,
}: {
  ticketId: string;
  canManageOrder: boolean;
  initialIdentity: AttendeeTicketIdentity;
}) {
  const [identity, setIdentity] = useState(initialIdentity);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [inAppBrowser, setInAppBrowser] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [showSend, setShowSend] = useState(false);

  useEffect(() => {
    setInAppBrowser(
      /FBAN|FBAV|Instagram|Line\/|LinkedInApp|TikTok|Snapchat|Twitter/i.test(navigator.userAgent),
    );
  }, []);

  async function claim() {
    setBusy(true);
    setMessage("");
    try {
      const result = await claimTicketIdentityFn({ data: { ticketId } });
      if (!result.ok) throw new Error(result.error);
      setMessage("This ticket is now saved to You across devices.");
      setIdentity((current) => ({
        ...current,
        personallyClaimed: true,
        anotherClaimedTicketName: undefined,
      }));
      if (result.value.publicTicketId !== ticketId) {
        window.location.replace(`/ticket/${encodeURIComponent(result.value.publicTicketId)}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This ticket could not be claimed");
    } finally {
      setBusy(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const result = await sendTicketOperationFn({
      data: {
        action: identity.personallyClaimed ? "transfer" : "assign",
        ticketId,
        recipientEmail,
      },
    });
    setMessage(
      result.ok
        ? identity.personallyClaimed
          ? "Transfer invitation sent. You keep the ticket until it is accepted."
          : "Assignment invitation sent. You can cancel it from You while it is pending."
        : result.error,
    );
    if (result.ok) {
      setRecipientEmail("");
      setShowSend(false);
    }
    setBusy(false);
  }

  return (
    <TicketIdentityControlsView
      ticketId={ticketId}
      account={identity.account}
      personallyClaimed={identity.personallyClaimed}
      anotherClaimedTicketName={identity.anotherClaimedTicketName}
      canManageOrder={canManageOrder}
      busy={busy}
      message={message}
      inAppBrowser={inAppBrowser}
      recipientEmail={recipientEmail}
      showSend={showSend}
      onClaim={() => void claim()}
      onRecipientEmailChange={setRecipientEmail}
      onSend={(event) => void send(event)}
      onToggleSend={() => setShowSend((current) => !current)}
    />
  );
}

export function TicketIdentityControlsView({
  ticketId,
  account,
  personallyClaimed,
  anotherClaimedTicketName,
  canManageOrder,
  busy,
  message,
  inAppBrowser,
  recipientEmail,
  showSend,
  onClaim,
  onRecipientEmailChange,
  onSend,
  onToggleSend,
}: {
  ticketId: string;
  account: Pick<AttendeeAccount, "name"> | null;
  personallyClaimed: boolean;
  anotherClaimedTicketName?: string;
  canManageOrder: boolean;
  busy: boolean;
  message: string;
  inAppBrowser: boolean;
  recipientEmail: string;
  showSend: boolean;
  onClaim: () => void;
  onRecipientEmailChange: (value: string) => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
  onToggleSend: () => void;
}) {
  return (
    <section id="ticket-recovery" aria-label="Keep this ticket across devices" className="mt-3">
      {personallyClaimed ? (
        <div>
          <p className="font-mono text-micro theme-muted">
            saved to your account{account?.name ? ` as ${account.name}` : ""} ·{" "}
            <Link to="/my" className="inline-flex min-h-11 items-center underline hover:opacity-70">
              manage
            </Link>
          </p>
          <button
            type="button"
            onClick={onToggleSend}
            className="min-h-11 py-3 font-mono text-micro underline hover:opacity-70"
          >
            send to someone
          </button>
        </div>
      ) : account ? (
        <div className="flex flex-wrap gap-x-5">
          <button
            type="button"
            disabled={busy}
            onClick={onClaim}
            className="min-h-11 py-3 font-mono text-micro theme-muted underline hover:opacity-70 disabled:opacity-50"
          >
            {busy
              ? "saving…"
              : anotherClaimedTicketName
                ? "save this ticket instead"
                : "save this ticket"}
          </button>
          {anotherClaimedTicketName ? (
            <span className="inline-flex min-h-11 items-center font-mono text-micro theme-faint">
              keep {anotherClaimedTicketName} saved
            </span>
          ) : null}
          {canManageOrder ? (
            <button
              type="button"
              onClick={onToggleSend}
              className="min-h-11 py-3 font-mono text-micro underline hover:opacity-70"
            >
              send to someone
            </button>
          ) : null}
        </div>
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
      {showSend ? (
        <form onSubmit={onSend} className="mt-3 border-y theme-border py-4">
          <label htmlFor={`ticket-recipient-${ticketId}`} className="block font-mono text-xs">
            recipient email
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id={`ticket-recipient-${ticketId}`}
              type="email"
              required
              value={recipientEmail}
              onChange={(event) => onRecipientEmailChange(event.target.value)}
              autoComplete="email"
              className="min-h-11 min-w-0 flex-1 border theme-border bg-background px-3 font-mono text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70 disabled:opacity-50"
            >
              {busy ? "sending…" : personallyClaimed ? "review and transfer" : "send assignment"}
            </button>
          </div>
          <EmailAddressNotice email={recipientEmail} onAcceptSuggestion={onRecipientEmailChange} />
          <p className="mt-2 font-mono text-micro leading-relaxed theme-muted">
            {personallyClaimed
              ? "You remain the holder until the recipient accepts. Scoring and refunds pause while pending."
              : "The recipient receives only this child ticket, never the rest of the order."}
          </p>
        </form>
      ) : null}
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
