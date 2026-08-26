import { type FormEvent, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { useNavigate, useRouter } from "@tanstack/react-router";

import { useActionDialog } from "@/hooks/useActionDialog";
import {
  beginPasskeyRegistrationFn,
  finishPasskeyRegistrationFn,
  renamePasskeyFn,
  revokePasskeyFn,
} from "../passkeys.functions";
import {
  beginTotpEnrollmentFn,
  disableTotpFn,
  finishTotpEnrollmentFn,
  regenerateRecoveryCodesFn,
} from "../totp.functions";
import { PasskeySignIn } from "./PasskeySignIn";

type Passkey = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
  backedUp: boolean;
  deviceType: "singleDevice" | "multiDevice";
};

type Totp = {
  enabled: boolean;
  label?: string;
  createdAt?: string;
  lastUsedAt?: string;
  recoveryCodesRemaining: number;
};

type Enrollment = {
  enrollmentId: string;
  secret: string;
  qrDataUrl: string;
};

export function SecuritySettingsPanel({
  initialPasskeys,
  initialTotp,
}: {
  initialPasskeys: Passkey[];
  initialTotp: Totp;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const { confirm, dialog } = useActionDialog();
  const [passkeys, setPasskeys] = useState(initialPasskeys);
  const [totp, setTotp] = useState(initialTotp);
  const [passkeyLabel, setPasskeyLabel] = useState("My passkey");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function addPasskey(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const begun = await beginPasskeyRegistrationFn();
      if (!begun.ok) throw new Error(begun.error);
      const response = await startRegistration({ optionsJSON: begun.value.options });
      const finished = await finishPasskeyRegistrationFn({
        data: { ceremonyId: begun.value.ceremonyId, response, label: passkeyLabel },
      });
      if (!finished.ok) throw new Error(finished.error);
      setPasskeys((current) => [finished.value.passkey, ...current]);
      setMessage("Passkey added. You can use it from the sign-in screen.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The passkey could not be added");
    } finally {
      setBusy(false);
    }
  }

  async function renamePasskey(passkeyId: string, label: string) {
    setBusy(true);
    setMessage("");
    const result = await renamePasskeyFn({ data: { passkeyId, label } });
    if (result.ok) {
      setPasskeys((current) =>
        current.map((passkey) => (passkey.id === passkeyId ? result.value.passkey : passkey)),
      );
      setMessage("Passkey renamed.");
    } else {
      setMessage(result.error);
    }
    setBusy(false);
  }

  async function removePasskey(passkey: Passkey) {
    if (
      !(await confirm({
        eyebrow: "sign-in security",
        title: `Remove ${passkey.label}?`,
        description: "This passkey will stop working and every device will be signed out.",
        confirmLabel: "remove passkey",
        intent: "danger",
      }))
    ) {
      return;
    }
    setBusy(true);
    setMessage("");
    const result = await revokePasskeyFn({ data: { passkeyId: passkey.id } });
    if (!result.ok) {
      setMessage(result.error);
      setBusy(false);
      return;
    }
    await navigate({ to: "/access", search: { returnTo: "/my" }, replace: true });
    router.clearCache();
    await router.invalidate();
  }

  async function beginTotp() {
    setBusy(true);
    setMessage("");
    const result = await beginTotpEnrollmentFn();
    if (result.ok) setEnrollment(result.value);
    else setMessage(result.error);
    setBusy(false);
  }

  async function finishTotp(event: FormEvent) {
    event.preventDefault();
    if (!enrollment) return;
    setBusy(true);
    setMessage("");
    const result = await finishTotpEnrollmentFn({
      data: { enrollmentId: enrollment.enrollmentId, token: totpCode },
    });
    if (result.ok) {
      setRecoveryCodes(result.value.recoveryCodes);
      setTotp({
        enabled: true,
        label: "Authenticator app",
        createdAt: new Date().toISOString(),
        recoveryCodesRemaining: result.value.recoveryCodes.length,
      });
      setEnrollment(null);
      setTotpCode("");
      setMessage("Authenticator app enabled. Save the recovery codes now.");
    } else {
      setMessage(result.error);
    }
    setBusy(false);
  }

  async function disableAuthenticator() {
    if (
      !(await confirm({
        eyebrow: "sign-in security",
        title: "Disable authenticator-app MFA?",
        description: "All recovery codes will be deleted and every device will be signed out.",
        confirmLabel: "disable MFA",
        intent: "danger",
      }))
    ) {
      return;
    }
    setBusy(true);
    setMessage("");
    const result = await disableTotpFn();
    if (!result.ok) {
      setMessage(result.error);
      setBusy(false);
      return;
    }
    await navigate({ to: "/access", search: { returnTo: "/my" }, replace: true });
    router.clearCache();
    await router.invalidate();
  }

  async function replaceRecoveryCodes() {
    if (
      !(await confirm({
        eyebrow: "account recovery",
        title: "Replace every recovery code?",
        description: "Every older recovery code will stop working immediately.",
        confirmLabel: "replace codes",
        intent: "default",
      }))
    ) {
      return;
    }
    setBusy(true);
    setMessage("");
    const result = await regenerateRecoveryCodesFn();
    if (result.ok) {
      setRecoveryCodes(result.value.recoveryCodes);
      setTotp((current) => ({
        ...current,
        recoveryCodesRemaining: result.value.recoveryCodes.length,
      }));
      setMessage("Recovery codes replaced. Save the new set now.");
    } else {
      setMessage(result.error);
    }
    setBusy(false);
  }

  async function copyRecoveryCodes() {
    await navigator.clipboard.writeText(recoveryCodes.join("\n"));
    setMessage("Recovery codes copied. Store them somewhere private.");
  }

  return (
    <details className="mt-10 border-t theme-border pt-2">
      <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs underline">
        sign-in security
      </summary>
      <div className="py-3">
        <section aria-labelledby="passkeys-heading">
          <h2 id="passkeys-heading" className="font-serif text-2xl">
            Passkeys
          </h2>
          <p className="mt-2 max-w-lg font-mono text-micro leading-relaxed theme-muted">
            Passkeys are the preferred sign-in method. Your device verifies you with Face ID, Touch
            ID, Windows Hello, or its screen lock; no biometric data reaches this site.
          </p>
          {passkeys.length ? (
            <ul className="mt-4 divide-y border-y theme-border">
              {passkeys.map((passkey) => (
                <PasskeyRow
                  key={passkey.id}
                  passkey={passkey}
                  busy={busy}
                  onRename={renamePasskey}
                  onRemove={() => void removePasskey(passkey)}
                />
              ))}
            </ul>
          ) : (
            <p className="mt-4 font-mono text-xs theme-muted">No passkeys saved yet.</p>
          )}
          {passkeys.length ? (
            <PasskeySignIn
              returnTo="/my"
              conditional={false}
              className="mt-4 max-w-sm"
              label="verify with a passkey"
              onAuthenticated={async () => {
                await router.invalidate();
                setMessage("Passkey verified for protected account changes.");
              }}
            />
          ) : null}
          <form onSubmit={addPasskey} className="mt-5 flex max-w-lg flex-wrap items-end gap-3">
            <label className="min-w-48 flex-1 font-mono text-xs">
              passkey name
              <input
                value={passkeyLabel}
                onChange={(event) => setPasskeyLabel(event.target.value)}
                minLength={1}
                maxLength={80}
                required
                className="mt-2 min-h-11 w-full border theme-border bg-background px-3 font-mono text-sm"
              />
            </label>
            <button type="submit" disabled={busy} className="mh-action mh-action--secondary">
              add passkey
            </button>
          </form>
        </section>

        <section className="mt-9 border-t theme-border pt-7" aria-labelledby="totp-heading">
          <h2 id="totp-heading" className="font-serif text-2xl">
            Authenticator app
          </h2>
          <p className="mt-2 max-w-lg font-mono text-micro leading-relaxed theme-muted">
            Optional six-digit TOTP codes work with Bitwarden and standard authenticator apps. They
            protect email sign-in, but passkeys remain safer because TOTP codes can be phished.
          </p>
          {totp.enabled ? (
            <div className="mt-4 border-y theme-border py-4">
              <p className="font-mono text-xs">
                enabled · {totp.recoveryCodesRemaining} unused recovery codes
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void replaceRecoveryCodes()}
                className="mh-action mh-action--secondary mr-3 mt-4"
              >
                replace recovery codes
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void disableAuthenticator()}
                className="mh-action mh-action--danger mt-4"
              >
                disable authenticator app
              </button>
            </div>
          ) : enrollment ? (
            <form onSubmit={finishTotp} className="mt-5">
              <img
                src={enrollment.qrDataUrl}
                alt="QR code for adding this account to an authenticator app"
                width={320}
                height={320}
                className="max-w-full"
              />
              <p className="mt-3 max-w-md font-mono text-micro leading-relaxed theme-muted">
                Scan the QR code in Bitwarden or another authenticator. If scanning is unavailable,
                enter this secret manually:
              </p>
              <code className="mt-2 block break-all font-mono text-xs">{enrollment.secret}</code>
              <label htmlFor="enrollment-code" className="mt-5 block font-mono text-xs">
                six-digit code
              </label>
              <input
                id="enrollment-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                required
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                className="mt-2 min-h-11 w-full max-w-sm border theme-border bg-background px-3 font-mono text-lg tracking-widest"
              />
              <button
                type="submit"
                disabled={busy || totpCode.length !== 6}
                className="mh-action mt-4 disabled:opacity-45"
              >
                verify and enable
              </button>
            </form>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void beginTotp()}
              className="mh-action mh-action--secondary mt-4"
            >
              set up authenticator app
            </button>
          )}
        </section>

        {recoveryCodes.length ? (
          <section className="mt-7 border-y theme-border py-5" aria-labelledby="recovery-heading">
            <h2 id="recovery-heading" className="font-serif text-2xl">
              Save these recovery codes
            </h2>
            <p className="mt-2 font-mono text-micro leading-relaxed theme-muted">
              Each code works once. They will not be shown again.
            </p>
            <ul className="mt-4 grid grid-cols-2 gap-2 font-mono text-xs">
              {recoveryCodes.map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => void copyRecoveryCodes()}
              className="mh-action mt-5"
            >
              copy recovery codes
            </button>
          </section>
        ) : null}

        {message ? (
          <p role="status" aria-live="polite" className="mt-5 font-mono text-xs theme-muted">
            {message}
          </p>
        ) : null}
        {dialog}
      </div>
    </details>
  );
}

function PasskeyRow({
  passkey,
  busy,
  onRename,
  onRemove,
}: {
  passkey: Passkey;
  busy: boolean;
  onRename: (id: string, label: string) => Promise<void>;
  onRemove: () => void;
}) {
  const [label, setLabel] = useState(passkey.label);
  return (
    <li className="py-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void onRename(passkey.id, label);
        }}
      >
        <label className="min-w-48 flex-1 font-mono text-micro theme-muted">
          passkey name
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            minLength={1}
            maxLength={80}
            required
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3 font-mono text-sm text-foreground"
          />
        </label>
        <button
          type="submit"
          disabled={busy || label === passkey.label}
          className="mh-action mh-action--quiet"
        >
          rename
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onRemove}
          className="mh-action mh-action--danger"
        >
          remove
        </button>
      </form>
      <p className="mt-2 font-mono text-micro theme-muted">
        added {new Date(passkey.createdAt).toLocaleDateString()}
        {passkey.lastUsedAt
          ? ` · last used ${new Date(passkey.lastUsedAt).toLocaleDateString()}`
          : ""}
        {passkey.backedUp ? " · synced" : " · this device"}
      </p>
    </li>
  );
}
