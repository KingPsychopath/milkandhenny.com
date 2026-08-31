import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { AppSelect } from "@/components/AppSelect";
import { getPublicStaffAwardClaimFn } from "@/features/event-scoring/public.functions";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/events/$slug_/award/$token")({
  loader: async ({ params }) => {
    const result = await getPublicStaffAwardClaimFn({
      data: { eventSlug: params.slug, token: params.token },
    });
    if (!result) throw notFound();
    return result;
  },
  component: StaffAwardClaimPage,
  head: ({ params }) =>
    buildSeoHead({
      title: "Claim event points",
      description: "Claim a short-lived event points award.",
      path: `/events/${params.slug}/award`,
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function StaffAwardClaimPage() {
  const { preview, activeParticipantId, tickets } = Route.useLoaderData();
  const { slug, token } = Route.useParams();
  const [ticketId, setTicketId] = useState(tickets.length === 1 ? tickets[0]!.ticketId : "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [claimedTicketId, setClaimedTicketId] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil((Date.parse(preview.expiresAt) - Date.now()) / 1_000)),
  );
  const attempted = useRef(false);

  const claim = useCallback(
    async (selectedTicket = ticketId) => {
      if (busy || preview.state !== "active") return;
      if (!activeParticipantId && tickets.length > 1 && !selectedTicket) {
        setError("Choose the ticket receiving these points.");
        return;
      }
      setBusy(true);
      setError("");
      try {
        const response = await fetch(
          `/api/events/${encodeURIComponent(slug)}/award-claims/${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ticketId: selectedTicket || undefined }),
          },
        );
        const body = (await response.json()) as { points?: number; error?: string };
        if (!response.ok) throw new Error(body.error ?? "The points could not be claimed");
        const activeTicket = tickets.find((ticket) => ticket.active);
        setClaimedTicketId(
          selectedTicket || activeTicket?.ticketId || tickets[0]?.ticketId || null,
        );
        setMessage(`+${body.points ?? preview.points} points confirmed.`);
        window.dispatchEvent(new Event("mah-score-wake"));
      } catch (claimError) {
        setError(
          claimError instanceof Error ? claimError.message : "The points could not be claimed",
        );
      } finally {
        setBusy(false);
      }
    },
    [activeParticipantId, busy, preview.points, preview.state, slug, ticketId, tickets, token],
  );

  useEffect(() => {
    const timer = window.setInterval(
      () =>
        setRemaining(Math.max(0, Math.ceil((Date.parse(preview.expiresAt) - Date.now()) / 1_000))),
      250,
    );
    return () => window.clearInterval(timer);
  }, [preview.expiresAt]);

  useEffect(() => {
    if (attempted.current || preview.state !== "active") return;
    if (!activeParticipantId && tickets.length !== 1) return;
    const target = activeParticipantId ? tickets.find((ticket) => ticket.active) : tickets[0];
    if (preview.requiresCheckIn && target && !target.checkedIn) return;
    attempted.current = true;
    void claim(tickets.length === 1 ? tickets[0]!.ticketId : "");
  }, [activeParticipantId, claim, preview.requiresCheckIn, preview.state, tickets]);

  const targetTicket = activeParticipantId
    ? tickets.find((ticket) => ticket.active)
    : (tickets.find((ticket) => ticket.ticketId === ticketId) ??
      (tickets.length === 1 ? tickets[0] : undefined));
  const waitingForCheckIn = Boolean(
    preview.requiresCheckIn && targetTicket && !targetTicket.checkedIn,
  );

  return (
    <main id="main" className="mx-auto min-h-screen w-full max-w-2xl px-6 py-14">
      <Link
        to="/events/$slug"
        params={{ slug }}
        className="inline-flex min-h-11 items-center font-mono text-xs underline hover:opacity-70"
      >
        ← event
      </Link>
      <header className="mt-10">
        <p className="font-mono text-micro uppercase tracking-widest theme-muted">quick award</p>
        <h1 className="mt-2 font-serif text-4xl">{preview.activityName}</h1>
        <p className="mt-3 font-serif text-5xl">+{preview.points}</p>
      </header>

      {message ? (
        <section
          className="score-celebration mt-10 border-y theme-border py-8 text-center"
          aria-live="polite"
        >
          <p className="font-serif text-3xl">{message}</p>
          <nav
            aria-label="After claiming points"
            className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-xs"
          >
            {claimedTicketId ? (
              <Link
                to="/ticket/$id"
                params={{ id: claimedTicketId }}
                className="inline-flex min-h-11 items-center underline"
              >
                ticket &amp; points
              </Link>
            ) : (
              <Link to="/my" className="inline-flex min-h-11 items-center underline">
                tickets &amp; points
              </Link>
            )}
            <Link
              to="/events/$slug/score"
              params={{ slug }}
              className="inline-flex min-h-11 items-center underline"
            >
              leaderboard
            </Link>
          </nav>
        </section>
      ) : preview.state !== "active" || remaining === 0 ? (
        <p className="mt-10 border-y theme-border py-6 font-serif text-xl">
          {preview.state === "claimed"
            ? "These points have already been claimed."
            : "This award QR has expired."}
        </p>
      ) : (
        <section className="mt-10 border-y theme-border py-6">
          <p className="font-mono text-xs theme-muted">expires in {remaining} seconds</p>
          {!activeParticipantId && tickets.length > 1 ? (
            <label className="mt-5 block font-mono text-xs">
              ticket receiving the points
              <AppSelect
                value={ticketId}
                onValueChange={setTicketId}
                options={[
                  { value: "", label: "choose a ticket" },
                  ...tickets.map((ticket) => ({
                    value: ticket.ticketId,
                    label: `${ticket.holderName} · ${ticket.checkedIn ? "checked in" : "not checked in"}`,
                  })),
                ]}
                variant="field"
                ariaLabel="Ticket receiving the points"
                className="mt-2"
              />
            </label>
          ) : null}
          {waitingForCheckIn && targetTicket ? (
            <div className="mt-5 border-y theme-border py-5" role="status">
              <p className="font-serif text-xl">Check in before claiming these points.</p>
              <p className="mt-2 font-mono text-xs leading-relaxed theme-muted">
                Show {targetTicket.holderName}&apos;s ticket QR at the door, then return here and
                try again. This points QR stays available until its timer ends.
              </p>
              <Link
                to="/ticket/$id"
                params={{ id: targetTicket.ticketId }}
                className="mt-3 inline-flex min-h-11 items-center font-mono text-xs underline"
              >
                open ticket for check-in
              </Link>
            </div>
          ) : null}
          {tickets.length === 0 && !activeParticipantId ? (
            <p className="mt-5 font-serif text-lg theme-subtle">
              Open your event ticket on this phone, then scan the award QR again.
            </p>
          ) : (
            <button
              type="button"
              disabled={busy || (!activeParticipantId && tickets.length > 1 && !ticketId)}
              onClick={() => void claim()}
              className="mh-action mh-action--primary mt-5 w-full disabled:opacity-50"
            >
              {busy
                ? "claiming…"
                : waitingForCheckIn
                  ? `check again and claim ${preview.points} points`
                  : `claim ${preview.points} points`}
            </button>
          )}
          {error ? (
            <p role="alert" className="mt-4 font-mono text-xs text-red-700 dark:text-red-300">
              {error}
            </p>
          ) : null}
        </section>
      )}
    </main>
  );
}
