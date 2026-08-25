import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useBrowserProfileForm } from "@/lib/client/browser-profile";

type AccessPageProps = { returnTo: string };

async function responseBody(response: Response): Promise<{ error?: string; returnTo?: string }> {
  return (await response.json().catch(() => ({}))) as { error?: string; returnTo?: string };
}

export function AccessPage({ returnTo }: AccessPageProps) {
  const hash = useRouterState({ select: (state) => state.location.hash });
  const [mounted, setMounted] = useState(false);
  const { email, setEmail, remember } = useBrowserProfileForm();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => setMounted(true), []);
  const linkCredential = useMemo(() => {
    if (!mounted) return null;
    const fragment = new URLSearchParams(hash.replace(/^#/, ""));
    const challengeId = fragment.get("challenge");
    const token = fragment.get("token");
    return challengeId && token ? { challengeId, token } : null;
  }, [hash, mounted]);

  async function requestEmail(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/attendee/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, returnTo }),
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(body.error ?? "The email could not be sent");
      remember({ email });
      setMessage("Email sent. Use the link or code within 15 minutes.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The email could not be sent");
    } finally {
      setBusy(false);
    }
  }

  async function verify(payload: Record<string, string>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/attendee/access", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(body.error ?? "That access code could not be verified");
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      window.location.assign(body.returnTo ?? returnTo);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That access code could not be verified");
      setBusy(false);
    }
  }

  return (
    <main id="main" className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 py-12">
      <Link
        to="/"
        className="w-fit font-mono text-micro theme-muted transition-opacity hover:opacity-60"
      >
        milk &amp; henny
      </Link>
      <div className="my-auto py-14">
        <header>
          <h1 className="font-serif text-5xl leading-tight">sign in</h1>
          <p className="mt-3 font-serif text-lg leading-relaxed theme-muted">
            Use your email to continue.
          </p>
        </header>

        {linkCredential ? (
          <section
            className="mt-10 border-y theme-border py-6"
            aria-labelledby="email-link-heading"
          >
            <h2 id="email-link-heading" className="font-serif text-xl">
              your link is ready
            </h2>
            <button
              type="button"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void verify(linkCredential)}
              className="mh-action mh-action--primary mt-5 w-full justify-between disabled:opacity-45"
            >
              <span>{busy ? "signing in…" : "sign in"}</span>
              <span aria-hidden="true" className="mh-action__cue">
                →
              </span>
            </button>
          </section>
        ) : null}

        <form onSubmit={requestEmail} className="mt-10">
          <label htmlFor="access-email" className="block font-mono text-xs">
            email
          </label>
          <input
            id="access-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 min-h-12 w-full border-b theme-border-strong bg-transparent px-1 font-mono text-base outline-none placeholder:theme-muted focus:border-foreground"
          />
          <button
            type="submit"
            disabled={busy}
            aria-busy={busy}
            className="mh-action mh-action--primary mt-6 w-full justify-between disabled:opacity-45"
          >
            <span>{busy ? "sending…" : "send sign-in link"}</span>
            <span aria-hidden="true" className="mh-action__cue">
              →
            </span>
          </button>
          <p className="mt-3 font-mono text-micro leading-relaxed theme-muted">
            Links work once and expire after 15 minutes. You can request five per email and 20 per
            network in a 15-minute window; a new request replaces earlier unused links.
          </p>
        </form>

        <details className="mt-6 border-t theme-border pt-1">
          <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs underline decoration-dotted underline-offset-4 transition-opacity hover:opacity-60">
            use a code
          </summary>
          <form
            className="pb-4 pt-2"
            onSubmit={(event) => {
              event.preventDefault();
              void verify({ email, code });
            }}
          >
            <label htmlFor="access-code" className="block font-mono text-xs">
              8-character code
            </label>
            <input
              id="access-code"
              name="code"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              required
              minLength={8}
              maxLength={8}
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              className="mt-2 min-h-12 w-full border-b theme-border-strong bg-transparent px-1 font-mono text-lg tracking-widest outline-none focus:border-foreground"
            />
            <button
              type="submit"
              disabled={busy}
              aria-busy={busy}
              className="mh-action mh-action--secondary mt-5 w-full disabled:opacity-45"
            >
              {busy ? "signing in…" : "sign in with code"}
            </button>
            <p className="mt-3 font-mono text-micro leading-relaxed theme-muted">
              A code stops after six incorrect attempts. Request a new email if it expires.
            </p>
          </form>
        </details>

        {message ? (
          <p role="status" aria-live="polite" className="mt-5 font-mono text-xs theme-muted">
            {message}
          </p>
        ) : null}
      </div>
    </main>
  );
}
