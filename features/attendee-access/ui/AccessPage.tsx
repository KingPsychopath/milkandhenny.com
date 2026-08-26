import { FormEvent, useCallback, useState } from "react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useBrowserProfileForm } from "@/lib/client/browser-profile";
import { requestAttendeeAccessFn, verifyAttendeeAccessFn } from "../access.functions";
import { PasskeySignIn } from "./PasskeySignIn";

type AccessPageProps = { returnTo: string; initialMessage?: string };

export function AccessPage({ returnTo, initialMessage = "" }: AccessPageProps) {
  const navigate = useNavigate();
  const router = useRouter();
  const { email, setEmail, remember } = useBrowserProfileForm();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState(initialMessage);

  const completeSignIn = useCallback(
    async (destination: string) => {
      window.history.replaceState(null, "", window.location.pathname);
      router.clearCache();
      await router.invalidate();
      await navigate({ to: destination, replace: true });
    },
    [navigate, router],
  );

  async function requestEmail(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await requestAttendeeAccessFn({ data: { email, returnTo } });
      if (!result.ok) throw new Error(result.error);
      remember({ email });
      setSent(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The email could not be sent");
    } finally {
      setBusy(false);
    }
  }

  const verify = useCallback(
    async (payload: Record<string, string>) => {
      setBusy(true);
      setMessage("");
      try {
        const result = await verifyAttendeeAccessFn({ data: payload });
        if (!result.ok) throw new Error(result.error);
        await completeSignIn(result.value.returnTo ?? returnTo);
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "That access code could not be verified",
        );
        setBusy(false);
      }
    },
    [completeSignIn, returnTo],
  );

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
            Continue with a passkey, or use your email.
          </p>
        </header>

        <PasskeySignIn returnTo={returnTo} onAuthenticated={completeSignIn} />

        <div className="my-8 flex items-center gap-4" aria-hidden="true">
          <span className="h-px flex-1 bg-[var(--stone-200)]" />
          <span className="font-mono text-micro theme-muted">or use email</span>
          <span className="h-px flex-1 bg-[var(--stone-200)]" />
        </div>

        <form onSubmit={requestEmail}>
          <label htmlFor="access-email" className="block font-mono text-xs">
            email
          </label>
          <input
            id="access-email"
            name="email"
            type="email"
            inputMode="email"
            // Conditional passkey mediation requires the WebAuthn autocomplete token.
            // oxlint-disable-next-line jsx-a11y/autocomplete-valid
            autoComplete="username webauthn"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(event) => {
              setSent(false);
              setEmail(event.target.value);
            }}
            className="mt-2 min-h-12 w-full border-b theme-border-strong bg-transparent px-1 font-mono text-base outline-none placeholder:theme-muted focus:border-foreground"
          />
          <button
            type="submit"
            disabled={busy}
            aria-busy={busy}
            className="mh-action mh-action--secondary mt-6 w-full justify-between disabled:opacity-45"
          >
            <span>{busy ? "sending…" : "send sign-in link"}</span>
            <span aria-hidden="true" className="mh-action__cue">
              →
            </span>
          </button>
          {sent ? (
            <p role="status" aria-live="polite" className="mt-3 font-mono text-xs theme-muted">
              Email sent. Use the link or code within 15 minutes.
            </p>
          ) : null}
        </form>

        <details className="mt-6 border-t theme-border pt-1">
          <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs underline decoration-dotted underline-offset-4 transition-opacity hover:opacity-60">
            sign in with a code
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
