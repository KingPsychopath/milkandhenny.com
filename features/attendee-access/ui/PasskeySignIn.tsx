import { useCallback, useEffect, useState } from "react";
import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";

import { beginPasskeyAuthenticationFn, finishPasskeyAuthenticationFn } from "../passkeys.functions";

function passkeyError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Passkey sign-in was cancelled or no matching passkey was available.";
  }
  return error instanceof Error ? error.message : "Passkey sign-in could not be completed.";
}

export function PasskeySignIn({
  returnTo,
  onAuthenticated,
  label = "sign in with a passkey",
  conditional = true,
  className = "mt-10",
}: {
  returnTo: string;
  onAuthenticated: (destination: string) => Promise<void>;
  label?: string;
  conditional?: boolean;
  className?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const authenticate = useCallback(
    async (conditional: boolean) => {
      const begun = await beginPasskeyAuthenticationFn({ data: { returnTo } });
      if (!begun.ok) throw new Error(begun.error);
      const response = await startAuthentication({
        optionsJSON: begun.value.options,
        useBrowserAutofill: conditional,
      });
      const finished = await finishPasskeyAuthenticationFn({
        data: { ceremonyId: begun.value.ceremonyId, response },
      });
      if (!finished.ok) throw new Error(finished.error);
      await onAuthenticated(finished.value.returnTo);
    },
    [onAuthenticated, returnTo],
  );

  useEffect(() => {
    const available = browserSupportsWebAuthn();
    setSupported(available);
    if (!available || !conditional) return;
    let active = true;
    let started = false;
    void browserSupportsWebAuthnAutofill().then(async (autofill) => {
      if (!active || !autofill) return;
      started = true;
      try {
        await authenticate(true);
      } catch (error) {
        if (
          active &&
          !(
            error instanceof DOMException &&
            (error.name === "AbortError" || error.name === "NotAllowedError")
          )
        ) {
          setMessage(passkeyError(error));
        }
      }
    });
    return () => {
      active = false;
      if (started) WebAuthnAbortService.cancelCeremony();
    };
  }, [authenticate, conditional]);

  if (!supported) return null;

  return (
    <section aria-labelledby="passkey-sign-in-heading">
      <h2 id="passkey-sign-in-heading" className="sr-only">
        Passkey sign-in
      </h2>
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        onClick={() => {
          setBusy(true);
          setMessage("");
          void authenticate(false)
            .catch((error: unknown) => setMessage(passkeyError(error)))
            .finally(() => setBusy(false));
        }}
        className={`mh-action mh-action--primary w-full justify-between disabled:opacity-45 ${className}`}
      >
        <span>{busy ? "checking passkey…" : label}</span>
        <span aria-hidden="true" className="mh-action__cue">
          →
        </span>
      </button>
      {message ? (
        <p role="status" aria-live="polite" className="mt-3 font-mono text-xs theme-muted">
          {message}
        </p>
      ) : null}
    </section>
  );
}
