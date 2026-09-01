import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { AppSelect } from "@/components/AppSelect";
import { getPublicDiscoveryFn } from "@/features/event-scoring/public.functions";
import {
  formatDiscoveryCooldown,
  useDiscoveryCooldown,
} from "@/features/event-scoring/ui/useDiscoveryCooldown";
import { CameraFeed } from "@/features/tickets/ui/CameraFeed";
import {
  ATTENDEE_CLAIMS_EVENT,
  attendeeClaimResultFromEvent,
  submitAttendeeClaim,
} from "@/features/event-scoring/ui/submitAttendeeClaim";
import { buildSeoHead } from "@/lib/shared/seo";

function clueCredential(raw: string): string {
  try {
    return new URL(raw, window.location.origin).hash
      ? (new URLSearchParams(new URL(raw, window.location.origin).hash.slice(1)).get("clue") ?? raw)
      : raw;
  } catch {
    return raw;
  }
}

function confirmedDiscoveryMessage(body: Record<string, unknown>) {
  const points = typeof body.points === "number" ? body.points : 0;
  const progress =
    body.progress && typeof body.progress === "object"
      ? (body.progress as { claimed?: unknown; total?: unknown; complete?: unknown })
      : undefined;
  return body.state === "held"
    ? "Saved for review while scoring is frozen."
    : `Claimed.${points > 0 ? ` ${points} points added.` : ""}${progress ? ` ${String(progress.claimed)} of ${String(progress.total)} clues found${progress.complete ? ". Collection complete." : "."}` : ""}`;
}

export const Route = createFileRoute("/events/$slug_/discoveries/$discoveryId")({
  loader: async ({ params }) => {
    const result = await getPublicDiscoveryFn({
      data: { eventSlug: params.slug, discoveryId: params.discoveryId },
    });
    if (!result) throw notFound();
    return result;
  },
  component: DiscoveryRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: "Event discovery",
      description: "Claim a discovery for your event score.",
      path: `/events/${params.slug}/discoveries/${params.discoveryId}`,
      robots: "noindex, nofollow",
    }),
});

function DiscoveryRoute() {
  const { discovery, activeParticipantId, tickets } = Route.useLoaderData();
  const [ticketId, setTicketId] = useState(tickets.length === 1 ? tickets[0]!.ticketId : "");
  const [presented, setPresented] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [claimPending, setClaimPending] = useState(false);
  const commandId = useRef(crypto.randomUUID());
  const { coolingDown, remainingSeconds, startCooldown } = useDiscoveryCooldown();

  useEffect(() => {
    const clue = new URLSearchParams(window.location.hash.slice(1)).get("clue");
    if (clue) setPresented(clue);
    if (!activeParticipantId && tickets.length === 0) {
      sessionStorage.setItem("mah-pending-discovery", window.location.href);
    }
  }, [activeParticipantId, tickets.length]);

  useEffect(() => {
    if (!claimPending) return;
    const settle = (event: Event) => {
      const detail = attendeeClaimResultFromEvent(event, commandId.current);
      if (!detail || detail.result.state === "pending") return;
      setClaimPending(false);
      commandId.current = crypto.randomUUID();
      if (detail.result.state === "rejected") {
        setIsError(true);
        setMessage(detail.result.error);
        return;
      }
      setIsError(false);
      setMessage(confirmedDiscoveryMessage(detail.result.body));
      setCameraOpen(false);
    };
    window.addEventListener(ATTENDEE_CLAIMS_EVENT, settle);
    return () => window.removeEventListener(ATTENDEE_CLAIMS_EVENT, settle);
  }, [claimPending]);

  async function claim() {
    if (!activeParticipantId && tickets.length > 1 && !ticketId) {
      setIsError(true);
      setMessage("Choose the ticket playing this hunt.");
      return;
    }
    setBusy(true);
    setMessage(null);
    setIsError(false);
    setClaimPending(false);
    try {
      const selectedTicket = tickets.find((ticket) => ticket.ticketId === ticketId);
      const participantId = activeParticipantId ?? selectedTicket?.participantId;
      if (!participantId) throw new Error("Choose the ticket playing this hunt");
      const result = await submitAttendeeClaim({
        commandId: commandId.current,
        eventSlug: discovery.eventSlug,
        participantId,
        ticketId: ticketId || tickets.find((ticket) => ticket.active)?.ticketId,
        url: `/api/events/${encodeURIComponent(discovery.eventSlug)}/discoveries/${encodeURIComponent(discovery.id)}/claim`,
        label: "Clue claim",
        body: {
          presented,
          commandId: commandId.current,
          ticketId: ticketId || undefined,
        },
      });
      if (result.state === "pending") {
        setClaimPending(true);
        setMessage("Claim saved on this device. It will confirm automatically when connected.");
        return;
      }
      if (result.state === "rejected") {
        const retryAfter = result.body?.retryAfterSeconds;
        if (result.status === 429 && typeof retryAfter === "number") {
          commandId.current = crypto.randomUUID();
          startCooldown(retryAfter);
          setIsError(false);
          setMessage("You’ve already claimed this discovery.");
          return;
        }
        commandId.current = crypto.randomUUID();
        throw new Error(result.error);
      }
      commandId.current = crypto.randomUUID();
      setMessage(confirmedDiscoveryMessage(result.body));
      setCameraOpen(false);
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "The clue could not be claimed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-12">
      <Link
        to="/events/$slug"
        params={{ slug: discovery.eventSlug }}
        className="font-mono text-xs underline hover:opacity-70"
      >
        ← event
      </Link>
      <header className="mt-10">
        <p className="font-mono text-micro theme-muted tracking-widest uppercase">discovery</p>
        <h1 className="mt-2 font-serif text-4xl text-foreground">{discovery.name}</h1>
        <p className="mt-3 font-mono text-xs theme-subtle">
          {discovery.method === "qr" || discovery.method === "collected-clues"
            ? "Review this clue, then claim it with your event ticket."
            : "Enter the code or phrase shown at the clue."}
        </p>
      </header>
      {!activeParticipantId && (discovery.rule.pointMode !== "none" || tickets.length === 0) ? (
        <p className="mt-10 border-y theme-border py-6 font-serif text-lg theme-subtle">
          {tickets.length === 0
            ? "Open your ticket on this device first, then return here to claim the clue."
            : "Choose a ticket for event points on its ticket page, then return here."}
        </p>
      ) : (
        <form
          className="mt-10 space-y-5 border-y theme-border py-6"
          onSubmit={(event) => {
            event.preventDefault();
            void claim();
          }}
        >
          {!activeParticipantId && tickets.length > 1 && (
            <label className="block font-mono text-xs">
              ticket playing this hunt
              <AppSelect
                value={ticketId}
                onValueChange={setTicketId}
                options={[
                  { value: "", label: "choose a ticket" },
                  ...tickets.map((ticket) => ({
                    value: ticket.ticketId,
                    label: ticket.holderName,
                  })),
                ]}
                variant="field"
                ariaLabel="Ticket playing this hunt"
                className="mt-2"
              />
            </label>
          )}
          <label className="block font-mono text-xs text-foreground" htmlFor="discovery-code">
            {discovery.method === "qr" || discovery.method === "collected-clues"
              ? "Clue credential"
              : "Code or phrase"}
          </label>
          <div className="flex border theme-border focus-within:border-foreground">
            <input
              id="discovery-code"
              className="min-h-11 min-w-0 flex-1 bg-transparent px-3 font-mono text-lg text-foreground outline-none"
              value={presented}
              onChange={(event) => setPresented(event.target.value)}
              placeholder="type or scan"
              autoComplete="off"
              required
            />
            {(discovery.method === "qr" || discovery.method === "collected-clues") && (
              <button
                type="button"
                aria-expanded={cameraOpen}
                onClick={() => setCameraOpen((current) => !current)}
                className="min-h-11 shrink-0 border-l theme-border px-3 font-mono text-xs hover:opacity-70"
              >
                {cameraOpen ? "close" : "camera"}
              </button>
            )}
          </div>
          {cameraOpen && (
            <div className="max-w-sm">
              <CameraFeed
                paused={busy || coolingDown}
                onCode={(raw) => {
                  setPresented(clueCredential(raw));
                  setCameraOpen(false);
                }}
              />
            </div>
          )}
          <button
            type="submit"
            disabled={busy || coolingDown}
            className="min-h-11 border theme-border px-4 font-mono text-xs uppercase tracking-wide hover:opacity-70 disabled:opacity-50"
          >
            {busy
              ? "Checking..."
              : coolingDown
                ? `Try again in ${formatDiscoveryCooldown(remainingSeconds)}`
                : "Claim clue"}
          </button>
          {message && (
            <p role={isError ? "alert" : "status"} className="font-mono text-xs theme-subtle">
              {message}
              {coolingDown && ` Try again in ${formatDiscoveryCooldown(remainingSeconds)}.`}
            </p>
          )}
        </form>
      )}
    </main>
  );
}
