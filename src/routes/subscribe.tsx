import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { SITE_BRAND } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/subscribe")({
  head: () => buildSeoHead({
    title: "Subscribe — " + SITE_BRAND,
    description: "Occasional news, events, and things from Milk & Henny.",
    path: "/subscribe",
  }),
  component: SubscribePage,
});

function SubscribePage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/marketing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not subscribe");
      setMessage("You are on the list. We will keep it occasional.");
      setEmail("");
      setName("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not subscribe");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main id="main" className="min-h-dvh px-6 py-12">
      <div className="mx-auto max-w-2xl">
        <Link to="/" className="font-mono text-sm font-bold tracking-tighter hover:opacity-70">
          {SITE_BRAND}
        </Link>
        <div className="mt-20 max-w-lg">
          <p className="font-mono text-micro uppercase tracking-widest theme-muted">occasional notes</p>
          <h1 className="mt-3 font-serif text-4xl leading-tight">Stay close.</h1>
          <p className="mt-5 font-serif text-lg leading-relaxed theme-muted">
            New events, good things, and the occasional note. No constant drip. You can leave at any time.
          </p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <label className="block"><span className="font-mono text-micro theme-muted">name (optional)</span><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" className="mt-1 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm" /></label>
            <label className="block"><span className="font-mono text-micro theme-muted">email</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="mt-1 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm" /></label>
            <button type="submit" disabled={busy} className="min-h-11 rounded bg-foreground px-5 font-mono text-sm text-background hover:opacity-90 disabled:opacity-50">{busy ? "joining…" : "join the list"}</button>
          </form>
          {message ? <p className="mt-4 font-mono text-xs theme-muted" role="status">{message}</p> : null}
          <p className="mt-8 font-mono text-micro leading-relaxed theme-faint">This is for marketing only. Ticket, access, refund, and event-change messages are separate service emails.</p>
        </div>
      </div>
    </main>
  );
}
