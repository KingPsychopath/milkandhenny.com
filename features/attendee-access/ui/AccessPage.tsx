import { type FormEvent, type RefObject, useCallback, useRef, useState } from "react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { EmailAddressNotice } from "@/components/EmailAddressNotice";
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
  const [sentTo, setSentTo] = useState("");
  const [message, setMessage] = useState(initialMessage);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const completeSignIn = useCallback(
    async (destination: string) => {
      window.history.replaceState(null, "", window.location.pathname);
      router.clearCache();
      await router.invalidate();
      await navigate({ to: destination, replace: true });
    },
    [navigate, router],
  );

  async function sendEmail() {
    setBusy(true);
    setMessage("");
    try {
      const result = await requestAttendeeAccessFn({ data: { email, returnTo } });
      if (!result.ok) throw new Error(result.error);
      remember({ email });
      setSentTo(email.trim());
      setCode("");
      requestAnimationFrame(() => codeInputRef.current?.focus());
    } catch (error) {
      setSentTo("");
      setMessage(error instanceof Error ? error.message : "The email could not be sent");
    } finally {
      setBusy(false);
    }
  }

  function useDifferentEmail() {
    setSentTo("");
    setCode("");
    setMessage("");
    requestAnimationFrame(() => emailInputRef.current?.focus());
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
        className="inline-flex min-h-11 w-fit items-center font-mono text-micro theme-muted transition-opacity hover:opacity-60"
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

        <PasskeySignIn returnTo={returnTo} conditional={!sentTo} onAuthenticated={completeSignIn} />

        <div className="my-8 flex items-center gap-4" aria-hidden="true">
          <span className="h-px flex-1 bg-[var(--stone-200)]" />
          <span className="font-mono text-micro theme-muted">or use email</span>
          <span className="h-px flex-1 bg-[var(--stone-200)]" />
        </div>

        {sentTo ? (
          <section aria-labelledby="email-sent-heading">
            <h2 id="email-sent-heading" className="font-serif text-2xl">
              check your email
            </h2>
            <p
              role="status"
              aria-live="polite"
              className="mt-2 font-mono text-xs leading-relaxed theme-muted"
            >
              We sent both a secure link and an 8-character code to {sentTo}. Use either within 15
              minutes.
            </p>
            <EmailCodeForm
              email={sentTo}
              code={code}
              busy={busy}
              inputRef={codeInputRef}
              autoFocus
              onCodeChange={setCode}
              onSubmit={verify}
            />
            <p className="mt-4 font-mono text-micro leading-relaxed theme-muted">
              Prefer the link? Open the same email and choose “continue securely.” We show a
              confirmation page before signing you in.
            </p>
            <div className="mt-5 flex flex-wrap gap-3 border-t theme-border pt-4">
              <button
                type="button"
                disabled={busy}
                onClick={() => void sendEmail()}
                className="mh-action mh-action--secondary"
              >
                send a fresh email
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={useDifferentEmail}
                className="mh-action mh-action--quiet"
              >
                use a different email
              </button>
            </div>
            <p className="mt-4 font-mono text-micro leading-relaxed theme-faint">
              If authenticator MFA is enabled, the next step asks for that six-digit code. An
              authenticator code cannot sign in by itself.
            </p>
          </section>
        ) : (
          <>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void sendEmail();
              }}
            >
              <label htmlFor="access-email" className="block font-mono text-xs">
                email
              </label>
              <input
                ref={emailInputRef}
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
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 min-h-12 w-full border-b theme-border-strong bg-transparent px-1 font-mono text-base outline-none placeholder:theme-muted focus:border-foreground"
              />
              <EmailAddressNotice email={email} onAcceptSuggestion={setEmail} />
              <button
                type="submit"
                disabled={busy}
                aria-busy={busy}
                className="mh-action mh-action--secondary mt-6 w-full justify-between disabled:opacity-45"
              >
                <span>{busy ? "sending…" : "send link and code"}</span>
                <span aria-hidden="true" className="mh-action__cue">
                  →
                </span>
              </button>
            </form>

            <details className="mt-6 border-t theme-border pt-1">
              <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs underline decoration-dotted underline-offset-4 transition-opacity hover:opacity-60">
                already have a sign-in code?
              </summary>
              <EmailCodeForm
                email={email}
                code={code}
                busy={busy}
                inputRef={codeInputRef}
                onCodeChange={setCode}
                onSubmit={verify}
              />
            </details>
          </>
        )}

        {message ? (
          <p role="alert" className="mt-5 font-mono text-xs theme-muted">
            {message}
          </p>
        ) : null}
      </div>
    </main>
  );
}

function EmailCodeForm({
  email,
  code,
  busy,
  inputRef,
  autoFocus = false,
  onCodeChange,
  onSubmit,
}: {
  email: string;
  code: string;
  busy: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
  onCodeChange: (code: string) => void;
  onSubmit: (payload: Record<string, string>) => Promise<void>;
}) {
  return (
    <form
      className="pt-5"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void onSubmit({ email, code });
      }}
    >
      <label htmlFor="access-code" className="block font-mono text-xs">
        8-character email code
      </label>
      <input
        ref={inputRef}
        id="access-code"
        name="code"
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="one-time-code"
        spellCheck={false}
        required
        minLength={8}
        maxLength={8}
        autoFocus={autoFocus}
        value={code}
        onChange={(event) =>
          onCodeChange(
            event.target.value
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, "")
              .slice(0, 8),
          )
        }
        className="mt-2 min-h-12 w-full border-b theme-border-strong bg-transparent px-1 font-mono text-lg tracking-widest outline-none focus:border-foreground"
      />
      <button
        type="submit"
        disabled={busy || code.length !== 8 || !email.trim()}
        aria-busy={busy}
        className="mh-action mt-5 w-full disabled:opacity-45"
      >
        {busy ? "signing in…" : "continue with email code"}
      </button>
    </form>
  );
}
