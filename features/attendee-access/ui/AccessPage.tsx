import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useBrowserProfileForm } from "@/lib/client/browser-profile";
import { requestAttendeeAccessFn, verifyAttendeeAccessFn } from "../access.functions";

type AccessPageProps = { returnTo: string };

export function AccessPage({ returnTo }: AccessPageProps) {
  const navigate = useNavigate();
  const router = useRouter();
  const hash = useRouterState({ select: (state) => state.location.hash });
  const [mounted, setMounted] = useState(false);
  const { email, setEmail, remember } = useBrowserProfileForm();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");
  const [linkVerificationFailed, setLinkVerificationFailed] = useState(false);
  const automaticCredential = useRef("");
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
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        router.clearCache();
        await router.invalidate();
        await navigate({ to: result.value.returnTo ?? returnTo, replace: true });
      } catch (error) {
        setLinkVerificationFailed(true);
        setMessage(
          error instanceof Error ? error.message : "That access code could not be verified",
        );
        setBusy(false);
      }
    },
    [navigate, returnTo, router],
  );

  useEffect(() => {
    if (!linkCredential) return;
    const credentialKey = `${linkCredential.challengeId}:${linkCredential.token}`;
    if (automaticCredential.current === credentialKey) return;
    automaticCredential.current = credentialKey;
    void verify(linkCredential);
  }, [linkCredential, verify]);

  const showForm = mounted && (!linkCredential || linkVerificationFailed);

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

        {mounted && linkCredential && !linkVerificationFailed ? (
          <p role="status" aria-live="polite" className="mt-10 font-mono text-xs theme-muted">
            signing in…
          </p>
        ) : null}

        {showForm ? (
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
              className="mh-action mh-action--primary mt-6 w-full justify-between disabled:opacity-45"
            >
              <span>{busy ? "sending…" : "send sign-in link"}</span>
              <span aria-hidden="true" className="mh-action__cue">
                →
              </span>
            </button>
            {sent ? (
              <p role="status" aria-live="polite" className="mt-3 font-mono text-xs theme-muted">
                check your email
              </p>
            ) : null}
          </form>
        ) : null}

        {showForm ? (
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
        ) : null}

        {message ? (
          <p role="status" aria-live="polite" className="mt-5 font-mono text-xs theme-muted">
            {message}
          </p>
        ) : null}
      </div>
    </main>
  );
}
