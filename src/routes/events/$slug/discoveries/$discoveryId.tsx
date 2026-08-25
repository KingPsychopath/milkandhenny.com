import { useEffect, useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { AppSelect } from "@/components/AppSelect";
import { getPublicDiscoveryFn } from "@/features/event-scoring/public.functions";
import {
  formatDiscoveryCooldown,
  useDiscoveryCooldown,
} from "@/features/event-scoring/ui/useDiscoveryCooldown";
import { CameraFeed } from "@/features/tickets/ui/CameraFeed";
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

export const Route = createFileRoute("/events/$slug/discoveries/$discoveryId")({
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
  const { coolingDown, remainingSeconds, startCooldown } = useDiscoveryCooldown();

  useEffect(() => {
    const clue = new URLSearchParams(window.location.hash.slice(1)).get("clue");
    if (clue) setPresented(clue);
    if (!activeParticipantId && tickets.length === 0) {
      sessionStorage.setItem("mah-pending-discovery", window.location.href);
    }
  }, [activeParticipantId, tickets.length]);

  async function claim() {
    if (!activeParticipantId && tickets.length > 1 && !ticketId) {
      setIsError(true);
      setMessage("Choose the ticket playing this hunt.");
      return;
    }
    setBusy(true);
    setMessage(null);
    setIsError(false);
    if (!navigator.onLine) {
      setBusy(false);
      setIsError(true);
      setMessage("No connection. Keep this page open and try again when the network returns.");
      return;
    }
    try {
      const response = await fetch(
        `/api/events/${encodeURIComponent(discovery.eventSlug)}/discoveries/${encodeURIComponent(discovery.id)}/claim`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ presented, commandId: crypto.randomUUID(), ticketId }),
        },
      );
      const body = (await response.json()) as {
        error?: string;
        state?: string;
        points?: number;
        progress?: { claimed: number; total: number; complete: boolean };
        retryAfterSeconds?: number;
      };
      startCooldown(body.retryAfterSeconds);
      if (!response.ok) {
        if (response.status === 429 && body.retryAfterSeconds) {
          setIsError(false);
          setMessage("You’ve already claimed this discovery.");
          return;
        }
        throw new Error(body.error ?? "The clue could not be claimed");
      }
      setMessage(
        body.state === "held"
          ? "Saved for review while scoring is frozen."
          : `Claimed.${(body.points ?? 0) > 0 ? ` ${body.points} points added.` : ""}${body.progress ? ` ${body.progress.claimed} of ${body.progress.total} clues found${body.progress.complete ? ". Collection complete." : "."}` : ""}`,
      );
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
      <a
        href={`/events/${encodeURIComponent(discovery.eventSlug)}`}
        className="font-mono text-xs underline hover:opacity-70"
      >
        ← event
      </a>
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
