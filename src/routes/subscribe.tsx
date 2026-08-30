import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { SiteFooter, SiteFooterBar } from "@/components/SiteFooter";
import { EmailAddressNotice } from "@/components/EmailAddressNotice";
import { SITE_BRAND } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/subscribe")({
  head: () =>
    buildSeoHead({
      title: "Stay close — " + SITE_BRAND,
      description:
        "Follow Milk & Henny by RSS or get occasional news, events, and things by email.",
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
    <div className="flex min-h-dvh flex-col bg-background">
      <main id="main" className="flex-1 px-6 py-12 sm:py-16">
        <div className="mx-auto max-w-2xl">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center font-mono text-sm font-bold tracking-tighter hover:opacity-70"
          >
            {SITE_BRAND}
          </Link>
          <div className="mt-20 max-w-lg">
            <p className="font-mono text-micro uppercase tracking-widest theme-muted">
              keep in touch
            </p>
            <h1 className="mt-3 font-serif text-4xl leading-tight">Stay close.</h1>
            <p className="mt-5 font-serif text-lg leading-relaxed theme-muted">
              Follow new words in your feed reader, or leave your email for occasional news, events,
              and good things. No constant drip.
            </p>
            <section className="mt-10 border-t theme-border pt-6" aria-labelledby="email-heading">
              <p className="font-mono text-micro uppercase tracking-widest theme-muted">
                email notes
              </p>
              <h2 id="email-heading" className="mt-2 font-serif text-2xl">
                Join the list.
              </h2>
              <form onSubmit={submit} className="mt-6 space-y-4">
                <label htmlFor="subscribe-name" className="block">
                  <span className="font-mono text-micro theme-muted">name (optional)</span>
                  <input
                    id="subscribe-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    className="mt-1 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-base sm:text-sm"
                  />
                </label>
                <label htmlFor="subscribe-email" className="block">
                  <span className="font-mono text-micro theme-muted">email</span>
                  <input
                    id="subscribe-email"
                    required
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    className="mt-1 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-base sm:text-sm"
                  />
                </label>
                <EmailAddressNotice email={email} onAcceptSuggestion={setEmail} />
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-11 rounded bg-foreground px-5 font-mono text-sm text-background hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? "joining…" : "join the list"}
                </button>
              </form>
              {message ? (
                <p className="mt-4 font-mono text-xs theme-muted" role="status" aria-live="polite">
                  {message}
                </p>
              ) : null}
              <p className="mt-8 font-mono text-micro leading-relaxed theme-faint">
                This is for marketing only. Ticket, access, refund, and event-change messages are
                separate service emails.
              </p>
            </section>
            <section className="mt-10 border-t theme-border pt-6" aria-labelledby="feed-heading">
              <p className="font-mono text-micro uppercase tracking-widest theme-muted">
                feed reader
              </p>
              <h2 id="feed-heading" className="mt-2 font-serif text-2xl">
                Follow the feed.
              </h2>
              <p className="mt-3 font-serif leading-relaxed theme-muted">
                Prefer reading on your own terms? Add the Milk & Henny feed to your reader.
              </p>
              <a
                href="/feed.xml"
                className="mt-5 inline-flex min-h-11 items-center font-mono text-sm underline decoration-dotted underline-offset-4 hover:opacity-70"
              >
                add the feed ↗
              </a>
            </section>
          </div>
        </div>
      </main>
      <SiteFooter>
        <SiteFooterBar
          leading={
            <span className="whitespace-nowrap">
              © {new Date().getFullYear()} {SITE_BRAND}
            </span>
          }
          trailing={
            <nav
              aria-label="Footer"
              className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 md:justify-end"
            >
              <Link to="/privacy" className="hover:text-foreground transition-colors">
                privacy
              </Link>
              <Link to="/contact" className="hover:text-foreground transition-colors">
                contact
              </Link>
              <Link to="/" className="hover:text-foreground transition-colors">
                ← home
              </Link>
            </nav>
          }
        />
      </SiteFooter>
    </div>
  );
}
