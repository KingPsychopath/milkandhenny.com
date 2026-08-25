import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { getDiscoveryClaimPageFn } from "@/features/event-scoring/public.functions";
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
  const { activeParticipant } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const [presented, setPresented] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    if (!activeParticipant) {
      sessionStorage.setItem("mah-pending-discovery", window.location.href);
    }
  }, [activeParticipant]);

  async function claim() {
    if (!presented.trim()) return;
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(slug)}/discoveries/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ presented: credential(presented), commandId: crypto.randomUUID() }),
      });
      const body = (await response.json()) as {
        error?: string;
        points?: number;
        state?: string;
        discovery?: { name: string };
        progress?: { claimed: number; total: number; complete: boolean };
      };
      if (!response.ok) throw new Error(body.error ?? "The clue could not be claimed");
      setMessage(
        `${body.discovery?.name ?? "Clue"} claimed. ${body.points ?? 0} points.${body.progress ? ` ${body.progress.claimed} of ${body.progress.total} found.` : ""}`,
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
        <h1 className="mt-2 font-serif text-4xl">Claim a clue</h1>
        <p className="mt-3 font-mono text-xs theme-muted">Scan a printed clue or enter its code.</p>
      </header>
      {!activeParticipant ? (
        <p className="mt-10 border-y theme-border py-6 font-serif text-lg">
          Open your event ticket on this device, then return here.
        </p>
      ) : (
        <section
          className="mt-10 space-y-5 border-y theme-border py-6"
          aria-label="Claim a discovery"
        >
          <button
            type="button"
            onClick={() => setCameraOpen((current) => !current)}
            className="min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70"
          >
            {cameraOpen ? "close camera" : "scan a clue"}
          </button>
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
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void claim();
            }}
            className="space-y-4"
          >
            <label htmlFor="discovery-entry" className="block font-mono text-xs">
              enter a code
            </label>
            <input
              id="discovery-entry"
              required
              value={presented}
              onChange={(event) => setPresented(event.target.value)}
              className="min-h-11 w-full border theme-border bg-transparent px-3 font-mono text-base"
            />
            <button
              disabled={busy}
              className="min-h-11 border border-foreground px-4 font-mono text-xs hover:opacity-70 disabled:opacity-50"
            >
              {busy ? "checking…" : "claim clue"}
            </button>
          </form>
          {message && (
            <p role={isError ? "alert" : "status"} className="font-mono text-xs theme-muted">
              {message}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
