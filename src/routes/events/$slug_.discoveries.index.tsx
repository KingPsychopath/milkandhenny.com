import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { AppSelect } from "@/components/AppSelect";
import { getDiscoveryClaimPageFn } from "@/features/event-scoring/public.functions";
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

function credential(raw: string): string {
  try {
    const url = new URL(raw, window.location.origin);
    return new URLSearchParams(url.hash.slice(1)).get("clue") ?? raw;
  } catch {
    return raw;
  }
}

function confirmedDiscoveryMessage(body: Record<string, unknown>) {
  const points = typeof body.points === "number" ? body.points : 0;
  const discovery = body.discovery;
  const discoveryName =
    discovery && typeof discovery === "object" && "name" in discovery
      ? String(discovery.name)
      : "Clue";
  const progress =
    body.progress && typeof body.progress === "object"
      ? (body.progress as { claimed?: unknown; total?: unknown })
      : undefined;
  return body.state === "held"
    ? `${discoveryName} saved for review while scoring is frozen.`
    : `${discoveryName} claimed.${points > 0 ? ` ${points} points.` : ""}${progress ? ` ${String(progress.claimed)} of ${String(progress.total)} found.` : ""}`;
}

export const Route = createFileRoute("/events/$slug_/discoveries/")({
  loader: ({ params }) => getDiscoveryClaimPageFn({ data: { eventSlug: params.slug } }),
  component: DiscoveriesRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: "Claim a clue",
      description: "Scan or enter an event discovery clue.",
      path: `/events/${params.slug}/discoveries`,
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function DiscoveriesRoute() {
  const { activeParticipantId, tickets } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const [ticketId, setTicketId] = useState(tickets.length === 1 ? tickets[0]!.ticketId : "");
  const [presented, setPresented] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [cooldownDiscovery, setCooldownDiscovery] = useState("");
  const [claimPending, setClaimPending] = useState(false);
  const commandId = useRef(crypto.randomUUID());
  const { clearCooldown, coolingDown, remainingSeconds, startCooldown } = useDiscoveryCooldown();

  useEffect(() => {
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
      setPresented("");
      setCameraOpen(false);
    };
    window.addEventListener(ATTENDEE_CLAIMS_EVENT, settle);
    return () => window.removeEventListener(ATTENDEE_CLAIMS_EVENT, settle);
  }, [claimPending]);

  async function claim() {
    if (!presented.trim()) return;
    if (!activeParticipantId && tickets.length > 1 && !ticketId) {
      setIsError(true);
      setMessage("Choose the ticket playing this hunt.");
      return;
    }
    setBusy(true);
    setMessage("");
    setIsError(false);
    setClaimPending(false);
    clearCooldown();
    setCooldownDiscovery("");
    try {
      const selectedTicket = tickets.find((ticket) => ticket.ticketId === ticketId);
      const participantId = activeParticipantId ?? selectedTicket?.participantId;
      if (!participantId) throw new Error("Choose the ticket playing this hunt");
      const result = await submitAttendeeClaim({
        commandId: commandId.current,
        eventSlug: slug,
        participantId,
        ticketId: ticketId || tickets.find((ticket) => ticket.active)?.ticketId,
        url: `/api/events/${encodeURIComponent(slug)}/discoveries/claim`,
        label: "Clue claim",
        body: {
          presented: credential(presented),
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
        commandId.current = crypto.randomUUID();
        const retryAfterSeconds = result.body?.retryAfterSeconds;
        const discovery = result.body?.discovery;
        if (result.status === 429 && typeof retryAfterSeconds === "number") {
          startCooldown(retryAfterSeconds);
          const discoveryName =
            discovery && typeof discovery === "object" && "name" in discovery
              ? String(discovery.name)
              : "This clue";
          setMessage(`${discoveryName} was already claimed.`);
          return;
        }
        throw new Error(result.error);
      }
      commandId.current = crypto.randomUUID();
      setMessage(confirmedDiscoveryMessage(result.body));
      setPresented("");
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
      <header>
        <p className="font-mono text-micro uppercase tracking-widest theme-muted">
          event discovery
        </p>
        <h1 className="mt-2 font-serif text-4xl">Find a clue</h1>
        <p className="mt-3 font-mono text-xs theme-muted">Scan a printed clue or enter its code.</p>
      </header>
      {!activeParticipantId && tickets.length === 0 ? (
        <p className="mt-10 border-y theme-border py-6 font-serif text-lg">
          Open your event ticket on this device, then return here.
        </p>
      ) : (
        <section
          className="mt-10 space-y-5 border-y theme-border py-6"
          aria-label="Claim a discovery"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void claim();
            }}
            className="space-y-4"
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
            <label htmlFor="discovery-entry" className="block font-mono text-xs">
              clue code
            </label>
            <div className="flex border theme-border focus-within:border-foreground">
              <input
                id="discovery-entry"
                required
                value={presented}
                onChange={(event) => setPresented(event.target.value)}
                placeholder="type or scan"
                autoComplete="off"
                className="min-h-11 min-w-0 flex-1 bg-transparent px-3 font-mono text-base outline-none"
              />
              <button
                type="button"
                aria-expanded={cameraOpen}
                onClick={() => setCameraOpen((current) => !current)}
                className="min-h-11 shrink-0 border-l theme-border px-3 font-mono text-xs hover:opacity-70"
              >
                {cameraOpen ? "close" : "camera"}
              </button>
            </div>
            {cameraOpen && (
              <div className="max-w-sm">
                <CameraFeed
                  paused={busy}
                  onCode={(raw) => {
                    setPresented(credential(raw));
                    setCameraOpen(false);
                  }}
                />
              </div>
            )}
            <button
              disabled={busy}
              className="min-h-11 border border-foreground px-4 font-mono text-xs hover:opacity-70 disabled:opacity-50"
            >
              {busy ? "checking…" : "claim"}
            </button>
          </form>
          {message && (
            <p role={isError ? "alert" : "status"} className="font-mono text-xs theme-muted">
              {message}
              {coolingDown &&
                ` ${cooldownDiscovery} can be claimed again in ${formatDiscoveryCooldown(remainingSeconds)}.`}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
