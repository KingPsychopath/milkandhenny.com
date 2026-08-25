import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";

type AccessPageProps = { returnTo: string };

async function responseBody(response: Response): Promise<{ error?: string; returnTo?: string }> {
  return (await response.json().catch(() => ({}))) as { error?: string; returnTo?: string };
}

export function AccessPage({ returnTo }: AccessPageProps) {
  const hash = useRouterState({ select: (state) => state.location.hash });
  const [mounted, setMounted] = useState(false);
  const [email, setEmail] = useState("");
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
      setMessage(
        "Check your email. The link and code expire in 15 minutes; a newer email replaces any earlier code.",
      );
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
    <main id="main" className="mx-auto min-h-screen w-full max-w-md px-6 py-14">
      <Link to="/" className="font-mono text-micro theme-muted hover:text-foreground">
        milk &amp; henny
      </Link>
      <h1 className="mt-10 font-serif text-4xl leading-tight">Your tickets, without a password.</h1>
      <p className="mt-4 font-serif text-lg leading-relaxed theme-muted">
        We’ll email a private one-time link and a short code. This device then remembers you for 60
        days.
      </p>

      {linkCredential && (
        <section className="mt-8 border-y theme-border py-6" aria-labelledby="email-link-heading">
          <h2 id="email-link-heading" className="font-serif text-xl">
            Continue from your email
          </h2>
          <p className="mt-2 font-mono text-xs theme-muted">
            The link has not been used yet. Continue to verify it on this device.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void verify(linkCredential)}
            className="mt-4 min-h-11 border theme-border-strong px-4 font-mono text-xs hover:opacity-70 disabled:opacity-50"
          >
            {busy ? "checking…" : "continue securely"}
          </button>
        </section>
      )}

      <form onSubmit={requestEmail} className="mt-8 space-y-3">
        <label htmlFor="access-email" className="block font-mono text-xs">
          email address
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
          className="min-h-11 w-full border theme-border bg-background px-3 font-mono text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 border theme-border-strong px-4 font-mono text-xs hover:opacity-70 disabled:opacity-50"
        >
          {busy ? "sending…" : "email my access link"}
        </button>
      </form>

      <details className="mt-8 border-t theme-border pt-2">
        <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs underline">
          enter the code instead
        </summary>
        <form
          className="space-y-3 pb-4"
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
            className="min-h-11 w-full border theme-border bg-background px-3 font-mono text-lg tracking-widest"
          />
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 border theme-border-strong px-4 font-mono text-xs hover:opacity-70 disabled:opacity-50"
          >
            verify code
          </button>
        </form>
      </details>

      {message && (
        <p role="status" className="mt-5 font-mono text-xs theme-muted">
          {message}
        </p>
      )}
      <p className="mt-10 font-mono text-micro theme-faint leading-relaxed">
        Signing in does not claim every ticket bought with this email. Each guest chooses their own
        ticket explicitly.
      </p>
    </main>
  );
}
