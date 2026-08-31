import { useState } from "react";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";

import {
  getWaitlistManagementFn,
  updateWaitlistManagementFn,
} from "@/features/event-waitlist/waitlist.functions";
import type { WaitlistManagementView } from "@/features/event-waitlist/types";
import { SITE_BRAND } from "@/lib/shared/config";

export const Route = createFileRoute("/waitlist/$token")({
  loader: {
    handler: async ({ params }) => {
      const result = await getWaitlistManagementFn({ data: { token: params.token } });
      if (!result.ok) throw notFound();
      return result.value;
    },
    staleReloadMode: "blocking",
  },
  staleTime: 0,
  gcTime: 0,
  preload: false,
  head: () => ({
    meta: [
      { title: `Event waitlist — ${SITE_BRAND}` },
      { name: "robots", content: "noindex,nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: WaitlistManagementPage,
});

function WaitlistManagementPage() {
  const initial = Route.useLoaderData();
  const { token } = Route.useParams();
  const [view, setView] = useState<WaitlistManagementView>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const act = async (action: "confirm" | "leave") => {
    setBusy(true);
    setError("");
    try {
      const result = await updateWaitlistManagementFn({ data: { token, action } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setView(result.value);
    } catch {
      setError("We could not update the waitlist. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const pending = view.status === "pending" && !view.confirmationExpired;
  const active = view.status === "active";
  const title = pending
    ? "Confirm your waitlist place"
    : active
      ? "You’re on the waitlist"
      : view.status === "notified"
        ? "Your availability alert was sent"
        : view.status === "left"
          ? "You’ve left the waitlist"
          : view.status === "undeliverable"
            ? "This email cannot receive alerts"
            : "This waitlist request has expired";

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="mx-auto w-full max-w-2xl px-6 pb-8 pt-12">
        <Link
          to="/"
          className="inline-flex min-h-11 items-center font-mono text-sm font-bold tracking-tighter hover:opacity-70"
        >
          {SITE_BRAND}
        </Link>
      </header>
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-6 pb-20">
        <p className="font-mono text-micro uppercase tracking-widest theme-muted">event waitlist</p>
        <h1 className="mt-3 font-serif text-4xl leading-tight">{title}</h1>
        <dl className="mt-8 divide-y theme-border border-y theme-border font-mono text-xs">
          <div className="grid grid-cols-[6rem_1fr] gap-4 py-3">
            <dt className="theme-muted">event</dt>
            <dd>{view.eventTitle}</dd>
          </div>
          <div className="grid grid-cols-[6rem_1fr] gap-4 py-3">
            <dt className="theme-muted">alert for</dt>
            <dd>{view.scopeLabel}</dd>
          </div>
          <div className="grid grid-cols-[6rem_1fr] gap-4 py-3">
            <dt className="theme-muted">email</dt>
            <dd>{view.emailHint}</dd>
          </div>
        </dl>

        {pending ? (
          <div className="mt-8">
            <p className="font-serif leading-relaxed theme-subtle">
              Confirm this address and we&apos;ll send one email when a place becomes available. An
              alert does not reserve a ticket.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void act("confirm")}
                disabled={busy}
                className="mh-action mh-action--primary disabled:opacity-50"
              >
                {busy ? "confirming…" : "confirm waitlist place"}
              </button>
              <button
                type="button"
                onClick={() => void act("leave")}
                disabled={busy}
                className="mh-action mh-action--quiet disabled:opacity-50"
              >
                this wasn&apos;t me
              </button>
            </div>
          </div>
        ) : active ? (
          <div className="mt-8">
            <p className="font-serif leading-relaxed theme-subtle">
              We&apos;ll send one alert when availability increases. You can leave before then at
              any time.
            </p>
            <button
              type="button"
              onClick={() => void act("leave")}
              disabled={busy}
              className="mh-action mh-action--quiet mt-5 disabled:opacity-50"
            >
              {busy ? "leaving…" : "leave this waitlist"}
            </button>
          </div>
        ) : (
          <p className="mt-8 font-serif leading-relaxed theme-subtle">
            {view.status === "notified"
              ? "The alert was one-shot, so this address is no longer waiting. Join again from the event page if tickets sold out before you got one."
              : view.status === "left"
                ? "No availability alert will be sent. You can join again from the event page."
                : view.status === "undeliverable"
                  ? "Delivery to this address was previously blocked after an email failure. Contact us if the address is now working."
                  : "Open the event page to make a fresh request if the waitlist is still available."}
          </p>
        )}

        {error ? (
          <p role="alert" className="mt-5 font-mono text-xs text-[var(--admin-danger)]">
            {error}
          </p>
        ) : null}

        <Link
          to="/events/$slug"
          params={{ slug: view.eventSlug }}
          className="mt-10 inline-flex min-h-11 items-center font-mono text-xs underline underline-offset-4 hover:opacity-70"
        >
          view event →
        </Link>
      </main>
    </div>
  );
}
