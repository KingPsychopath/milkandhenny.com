import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import {
  acceptTicketAction,
  declineTicketTransfer,
  inspectTicketAction,
} from "@/features/attendee-operations/ticket-operations.server";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

const readAction = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(({ data }) => inspectTicketAction(data.token));

const acceptAction = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(({ data }) => acceptTicketAction(data.token));

const declineAction = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(({ data }) => declineTicketTransfer(data.token));

export const Route = createFileRoute("/action/$token")({
  loader: ({ params }) => readAction({ data: { token: params.token } }),
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
    const result = await acceptAction({ data: { token } });
    if (!result.ok) {
      setMessage(result.error);
      setBusy(null);
      return;
    }
    setDestination(`/ticket/${result.value.publicTicketId}`);
    setMessage(
      result.value.purpose === "ticket-transfer"
        ? "Transfer accepted. The previous ticket link and QR have been replaced."
        : "Ticket claimed. It is now saved in You.",
    );
    setBusy(null);
  }

  async function decline() {
    setBusy("decline");
    setMessage("");
    const result = await declineAction({ data: { token } });
    setMessage(
      result.ok ? "Transfer declined. The current holder keeps the ticket." : result.error,
    );
    setBusy(null);
  }

  const unavailable = !preview || preview.state !== "available";
  const actionLabel =
    preview?.purpose === "ticket-assignment" ? "use this ticket" : "accept transfer";

  return (
    <main id="main" className="mx-auto min-h-screen w-full max-w-2xl px-6 py-14">
      <Link to="/" className="font-mono text-micro theme-muted hover:opacity-70">
        ← milk &amp; henny
      </Link>
      <p className="mt-10 font-mono text-micro uppercase tracking-widest theme-muted">
        private ticket action
      </p>
      <h1 className="mt-2 font-serif text-4xl">
        {preview?.purpose === "ticket-assignment" ? "Your ticket" : "Ticket transfer"}
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
            {preview.eventTitle}
          </h2>
          <dl className="mt-4 space-y-3 font-mono text-xs">
            <div>
              <dt className="theme-muted">ticket</dt>
              <dd className="mt-1">{preview.ticketLabel}</dd>
            </div>
            <div>
              <dt className="theme-muted">invited email</dt>
              <dd className="mt-1">{preview.intendedEmailHint}</dd>
            </div>
            <div>
              <dt className="theme-muted">expires</dt>
              <dd className="mt-1">{preview.expiresAt}</dd>
            </div>
          </dl>
          <p className="mt-5 max-w-lg font-mono text-xs leading-relaxed theme-muted">
            Accepting verifies the invited email and saves the ticket to You. A transfer replaces
            the previous holder&apos;s link and QR. It does not move payment or refund ownership.
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
              {preview.purpose === "ticket-transfer" ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void decline()}
                  className="min-h-11 border theme-border px-4 py-3 font-mono text-xs hover:opacity-70 disabled:opacity-50"
                >
                  {busy === "decline" ? "declining…" : "decline"}
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
          open ticket →
        </a>
      ) : null}
      <p className="mt-10 font-mono text-micro leading-relaxed theme-faint">
        Milk &amp; Henny does not support private resale payments. Refunds return only to the
        original payment method.
      </p>
    </main>
  );
}

function SafeActionState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 border-y theme-border py-6">
      <h2 className="font-serif text-2xl">{title}</h2>
      <p className="mt-3 font-mono text-xs leading-relaxed theme-muted">{children}</p>
    </section>
  );
}
