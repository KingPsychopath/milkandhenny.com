import { useEffect, useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { getPublicDiscoveryFn } from "@/features/event-scoring/public.functions";
import { buildSeoHead } from "@/lib/shared/seo";

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
  const { discovery, activeParticipantId } = Route.useLoaderData();
  const [presented, setPresented] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const clue = new URLSearchParams(window.location.hash.slice(1)).get("clue");
    if (clue) setPresented(clue);
  }, []);

  async function claim() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/events/${encodeURIComponent(discovery.eventSlug)}/discoveries/${encodeURIComponent(discovery.id)}/claim`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ presented, commandId: crypto.randomUUID() }),
        },
      );
      const body = (await response.json()) as { error?: string; state?: string; points?: number };
      if (!response.ok) throw new Error(body.error ?? "The clue could not be claimed");
      setMessage(
        body.state === "held"
          ? "Saved for review while scoring is frozen."
          : `Claimed. ${body.points ?? 0} points added.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The clue could not be claimed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-12">
      <a
        href={`/events/${encodeURIComponent(discovery.eventSlug)}/score`}
        className="font-mono text-xs underline hover:opacity-70"
      >
        ← event score
      </a>
      <header className="mt-10">
        <p className="font-mono text-micro theme-muted tracking-widest uppercase">discovery</p>
        <h1 className="mt-2 font-serif text-4xl text-foreground">{discovery.name}</h1>
        <p className="mt-3 font-mono text-xs theme-subtle">
          Enter the code or phrase shown at the clue.
        </p>
      </header>
      {!activeParticipantId ? (
        <p className="mt-10 border-y theme-border py-6 font-serif text-lg theme-subtle">
          Open your ticket on this device first, then return here to claim the clue.
        </p>
      ) : (
        <form
          className="mt-10 space-y-5 border-y theme-border py-6"
          onSubmit={(event) => {
            event.preventDefault();
            void claim();
          }}
        >
          <label className="block font-mono text-xs text-foreground" htmlFor="discovery-code">
            Code or phrase
          </label>
          <input
            id="discovery-code"
            className="min-h-11 w-full border-b theme-border bg-transparent px-0 py-2 font-mono text-lg text-foreground outline-none focus:border-foreground"
            value={presented}
            onChange={(event) => setPresented(event.target.value)}
            autoComplete="off"
            required
          />
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 border theme-border px-4 font-mono text-xs uppercase tracking-wide hover:opacity-70 disabled:opacity-50"
          >
            {busy ? "Checking..." : "Claim discovery"}
          </button>
          {message && (
            <p role="status" className="font-mono text-xs theme-subtle">
              {message}
            </p>
          )}
        </form>
      )}
    </main>
  );
}
