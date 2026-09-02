import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  acceptAttendeeActionFn,
  declineAttendeeActionFn,
  readAttendeeActionFn,
} from "@/features/attendee-operations/action.functions";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/action/$token")({
  loader: {
    handler: ({ params }) => readAttendeeActionFn({ data: { token: params.token } }),
    staleReloadMode: "blocking",
  },
  staleTime: 0,
  gcTime: 0,
  preload: false,
  component: TicketActionPage,
  head: () =>
    buildSeoHead({
      title: `Ticket action — ${SITE_NAME}`,
      description: "Review a private ticket action.",
      path: "/action",
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function TicketActionPage() {
  const preview = Route.useLoaderData();
  const { token } = Route.useParams();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [message, setMessage] = useState("");
  const [destination, setDestination] = useState<string>();

  async function accept() {
    setBusy("accept");
    setMessage("");
    try {
      const result = await acceptAttendeeActionFn({ data: { token } });
      if (!result.ok) {
        setMessage(result.error);
        if (result.status === 401) {
          setDestination(`/access?returnTo=${encodeURIComponent(`/action/${token}`)}`);
        }
        return;
      }
      if (result.value.mfaRequired) {
        setDestination(result.value.destination);
        setMessage("Action confirmed. Finish the authenticator check to continue signing in.");
      } else if ("purpose" in result.value && result.value.purpose === "admin-invitation") {
        setDestination(result.value.destination);
        setMessage("Admin access activated. It is now attached to your verified identity.");
      } else if ("purpose" in result.value && result.value.purpose === "staff-invitation") {
        setDestination(result.value.destination);
        setMessage("Your account is ready and the staff role has been activated.");
      } else if ("publicTicketId" in result.value) {
        setDestination(result.value.destination);
        setMessage(
          result.value.purpose === "ticket-transfer"
            ? "Transfer accepted. The previous ticket link and QR have been replaced."
            : "Ticket claimed. It is now saved in You.",
        );
      } else if ("state" in result.value) {
        setDestination(result.value.destination);
        setMessage(
          result.value.state === "pending"
            ? "Consent recorded. The refund is processing to the purchaser’s original payment method."
            : "Consent recorded. The ticket was refunded to the purchaser’s original payment method.",
        );
      }
    } catch {
      setMessage("We could not complete that action. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function decline() {
    setBusy("decline");
    setMessage("");
    try {
      const result = await declineAttendeeActionFn({ data: { token } });
      setMessage(
        result.ok
          ? isRefundConsent
            ? "Refund consent declined. The ticket remains with its current holder."
            : "Transfer declined. The current holder keeps the ticket."
          : result.error,
      );
    } catch {
      setMessage("We could not decline that action. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const unavailable = !preview || preview.state !== "available";
  const isAccess = preview?.kind === "access";
  const isRefundConsent =
    preview?.kind === "ticket" &&
    (preview.purpose === "refund-consent" || preview.purpose === "ticket-return");
  const actionLabel =
    preview?.purpose === "ticket-assignment"
      ? "use this ticket"
      : isAccess
        ? "accept access"
        : isRefundConsent
          ? "consent to refund"
          : "accept transfer";

  return (
    <main id="main" className="mx-auto min-h-screen w-full max-w-2xl px-6 py-14">
      <Link
        to="/"
        className="inline-flex min-h-11 items-center font-mono text-micro theme-muted hover:opacity-70"
      >
        ← milk &amp; henny
      </Link>
      <p className="mt-10 font-mono text-micro uppercase tracking-widest theme-muted">
        private action
      </p>
      <h1 className="mt-2 font-serif text-4xl">
        {isAccess
          ? preview.title
          : isRefundConsent
            ? "Ticket refund consent"
            : preview?.purpose === "ticket-assignment"
              ? "Your ticket"
              : "Ticket transfer"}
      </h1>

      {!preview ? (
        <SafeActionState title="This link is no longer available">
          It may have expired, been cancelled, or been replaced. No attendee details are shown here.
        </SafeActionState>
      ) : unavailable ? (
        <SafeActionState
          title={
            preview.state === "expired"
              ? "This invitation expired"
              : preview.state === "cancelled"
                ? "This action was cancelled"
                : "This action is already complete"
          }
        >
          Ask the sender for a fresh invitation if you still need access.
        </SafeActionState>
      ) : (
        <section className="mt-8 border-y theme-border py-6" aria-labelledby="action-summary">
          <h2 id="action-summary" className="font-serif text-2xl">
            {isAccess ? preview.label : preview.eventTitle}
          </h2>
          <dl className="mt-4 space-y-3 font-mono text-xs">
            {preview.kind === "ticket" ? (
              <div>
                <dt className="theme-muted">ticket</dt>
                <dd className="mt-1">{preview.ticketLabel}</dd>
              </div>
            ) : preview.eventSlug ? (
              <div>
                <dt className="theme-muted">event</dt>
                <dd className="mt-1">{preview.eventSlug}</dd>
              </div>
            ) : null}
            <div>
              <dt className="theme-muted">invited email</dt>
              <dd className="mt-1">{preview.intendedEmailHint}</dd>
            </div>
            {preview.expiresAt ? (
              <div>
                <dt className="theme-muted">expires</dt>
                <dd className="mt-1">
                  <time dateTime={preview.expiresAt}>{formatActionExpiry(preview.expiresAt)}</time>
                </dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-5 max-w-lg font-mono text-xs leading-relaxed theme-muted">
            {isAccess
              ? "Accepting verifies the invited mailbox, creates their Milk & Henny account if needed, signs them in and attaches this authority. If another person is signed in, their identity is not merged or changed."
              : isRefundConsent
                ? "The purchaser requested this refund. Consenting cancels this ticket and returns money only to the purchaser’s original payment method."
                : "Accepting verifies the invited email and saves the ticket to You. A transfer replaces the previous holder’s link and QR. It does not move payment or refund ownership."}
          </p>
          {!destination ? (
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void accept()}
                className="min-h-11 bg-foreground px-4 py-3 font-mono text-xs text-background hover:opacity-80 disabled:opacity-50"
              >
                {busy === "accept" ? "confirming…" : actionLabel}
              </button>
              {preview.kind === "ticket" &&
              (preview.purpose === "ticket-transfer" || isRefundConsent) ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void decline()}
                  className="min-h-11 border theme-border px-4 py-3 font-mono text-xs hover:opacity-70 disabled:opacity-50"
                >
                  {busy === "decline"
                    ? "declining…"
                    : isRefundConsent
                      ? "do not consent"
                      : "decline"}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      )}

      {message ? (
        <p role="status" className="mt-6 font-mono text-xs leading-relaxed theme-muted">
          {message}
        </p>
      ) : null}
      {destination ? (
        <a
          href={destination}
          className="mt-4 inline-flex min-h-11 items-center font-mono text-xs underline hover:opacity-70"
        >
          continue →
        </a>
      ) : null}
      <p className="mt-10 font-mono text-micro leading-relaxed theme-faint">
        Milk &amp; Henny does not support private resale payments. Refunds return only to the
        original payment method.
      </p>
    </main>
  );
}

function formatActionExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function SafeActionState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 border-y theme-border py-6">
      <h2 className="font-serif text-2xl">{title}</h2>
      <p className="mt-3 font-mono text-xs leading-relaxed theme-muted">{children}</p>
    </section>
  );
}
