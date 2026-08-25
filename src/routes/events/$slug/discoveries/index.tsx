import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { getDiscoveryClaimPageFn } from "@/features/event-scoring/public.functions";
import {
  formatDiscoveryCooldown,
  useDiscoveryCooldown,
} from "@/features/event-scoring/ui/useDiscoveryCooldown";
import { CameraFeed } from "@/features/tickets/ui/CameraFeed";
import { buildSeoHead } from "@/lib/shared/seo";

function credential(raw: string): string {
  try {
    const url = new URL(raw, window.location.origin);
    return new URLSearchParams(url.hash.slice(1)).get("clue") ?? raw;
  } catch {
    return raw;
  }
}

export const Route = createFileRoute("/events/$slug/discoveries/")({
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
  const { clearCooldown, coolingDown, remainingSeconds, startCooldown } = useDiscoveryCooldown();

  useEffect(() => {
    if (!activeParticipantId && tickets.length === 0) {
      sessionStorage.setItem("mah-pending-discovery", window.location.href);
    }
  }, [activeParticipantId, tickets.length]);

  async function claim() {
    if (!presented.trim()) return;
    setBusy(true);
    setMessage("");
    setIsError(false);
    clearCooldown();
    setCooldownDiscovery("");
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(slug)}/discoveries/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          presented: credential(presented),
          commandId: crypto.randomUUID(),
          ticketId: ticketId || undefined,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        points?: number;
        state?: string;
        discovery?: { name: string };
        progress?: { claimed: number; total: number; complete: boolean };
        retryAfterSeconds?: number;
      };
      if (body.retryAfterSeconds) {
        startCooldown(body.retryAfterSeconds);
        setCooldownDiscovery(body.discovery?.name ?? "This clue");
      }
      if (!response.ok) {
        if (response.status === 429 && body.retryAfterSeconds) {
          setMessage(`${body.discovery?.name ?? "This clue"} was already claimed.`);
          return;
        }
        throw new Error(body.error ?? "The clue could not be claimed");
      }
      setMessage(
        `${body.discovery?.name ?? "Clue"} claimed.${
          (body.points ?? 0) > 0 ? ` ${body.points} points.` : ""
        }${body.progress ? ` ${body.progress.claimed} of ${body.progress.total} found.` : ""}`,
      );
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
                <select
                  required
                  value={ticketId}
                  onChange={(event) => setTicketId(event.target.value)}
                  className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
                >
                  <option value="">choose a ticket</option>
                  {tickets.map((ticket) => (
                    <option key={ticket.ticketId} value={ticket.ticketId}>
                      {ticket.holderName}
                    </option>
                  ))}
                </select>
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
