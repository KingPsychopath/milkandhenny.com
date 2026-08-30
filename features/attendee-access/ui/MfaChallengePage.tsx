import { type FormEvent, useState } from "react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";

import { verifyRecoveryCodeFn, verifyTotpFn } from "../totp.functions";
import { PasskeySignIn } from "./PasskeySignIn";

export function MfaChallengePage({ returnTo }: { returnTo: string }) {
  const navigate = useNavigate();
  const router = useRouter();
  const [token, setToken] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function complete(destination: string) {
    window.history.replaceState(null, "", "/access/mfa");
    router.clearCache();
    await router.invalidate();
    await navigate({ to: destination, replace: true });
  }

  async function verifyTotp(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await verifyTotpFn({ data: { token } });
      if (!result.ok) throw new Error(result.error);
      await complete(result.value.returnTo);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That code could not be verified");
      setBusy(false);
    }
  }

  async function verifyRecovery(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await verifyRecoveryCodeFn({ data: { code: recoveryCode } });
      if (!result.ok) throw new Error(result.error);
      await complete(result.value.returnTo);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That recovery code was not valid");
      setBusy(false);
    }
  }

  return (
    <main id="main" className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 py-12">
      <Link
        to="/"
        className="inline-flex min-h-11 w-fit items-center font-mono text-micro theme-muted hover:opacity-60"
      >
        milk &amp; henny
      </Link>
      <div className="my-auto py-14">
        <p className="font-mono text-micro theme-muted">one more step</p>
        <h1 className="mt-3 font-serif text-5xl leading-tight">verify your sign-in</h1>
        <p className="mt-3 font-serif text-lg leading-relaxed theme-muted">
          Your email is verified. Now enter the six-digit code from your authenticator app.
        </p>

        <form onSubmit={verifyTotp} className="mt-8">
          <label htmlFor="totp-code" className="block font-mono text-xs">
            authenticator code
          </label>
          <input
            id="totp-code"
            name="token"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            required
            autoFocus
            value={token}
            onChange={(event) => setToken(event.target.value.replace(/\D/g, "").slice(0, 6))}
            className="mt-2 min-h-12 w-full border-b theme-border-strong bg-transparent px-1 font-mono text-xl tracking-[0.3em] outline-none focus:border-foreground"
          />
          <button
            type="submit"
            disabled={busy || token.length !== 6}
            className="mh-action mt-6 w-full disabled:opacity-45"
          >
            {busy ? "checking…" : "continue"}
          </button>
        </form>

        <details className="mt-7 border-t theme-border pt-1">
          <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs underline decoration-dotted underline-offset-4 hover:opacity-60">
            use a recovery code
          </summary>
          <form onSubmit={verifyRecovery} className="pb-4 pt-2">
            <label htmlFor="recovery-code" className="block font-mono text-xs">
              recovery code
            </label>
            <input
              id="recovery-code"
              name="recovery-code"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())}
              className="mt-2 min-h-12 w-full border-b theme-border-strong bg-transparent px-1 font-mono text-base tracking-wider outline-none focus:border-foreground"
            />
            <button
              type="submit"
              disabled={busy}
              className="mh-action mh-action--secondary mt-5 w-full disabled:opacity-45"
            >
              use recovery code
            </button>
          </form>
        </details>

        <div className="mt-7 border-t theme-border pt-7">
          <p className="font-mono text-micro theme-muted">
            A saved passkey can sign you in directly and is the safer option.
          </p>
          <PasskeySignIn returnTo={returnTo} conditional={false} onAuthenticated={complete} />
        </div>

        <Link
          to="/access"
          search={{ returnTo }}
          replace
          className="mt-5 inline-flex min-h-11 items-center font-mono text-xs underline hover:opacity-60"
        >
          start sign-in again
        </Link>

        {message ? (
          <p role="alert" className="mt-5 font-mono text-xs theme-muted">
            {message}
          </p>
        ) : null}
      </div>
    </main>
  );
}
