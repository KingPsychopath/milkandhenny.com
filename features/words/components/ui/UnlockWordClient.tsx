import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { unlockPrivateWordFn } from "../../reader.functions";

type Props = {
  slug: string;
  shareToken: string;
  initialPinRequired: boolean;
  initialError?: string;
};

export function UnlockWordClient({ slug, shareToken, initialPinRequired, initialError }: Props) {
  const navigate = useNavigate({ from: "/vault/$slug" });
  const [pin, setPin] = useState("");
  const [pinRequired, setPinRequired] = useState(initialPinRequired);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(initialError ?? "");
  const hasShare = shareToken.trim().length > 0;

  async function verifyShareAccess(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!hasShare) return;
    setChecking(true);
    setError("");
    try {
      const result = await unlockPrivateWordFn({
        data: { slug, token: shareToken, pin: pinRequired ? pin : undefined },
      });
      if (!result.ok) {
        setPinRequired(result.pinRequired);
        setError(result.error);
        return;
      }
      await navigate({
        to: "/vault/$slug",
        params: { slug },
        search: {},
        replace: true,
      });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setChecking(false);
    }
  }

  if (!hasShare) {
    return (
      <div className="border theme-border rounded-md p-5 space-y-2">
        <p className="font-mono text-xs tracking-wide uppercase theme-muted">private page</p>
        <p className="font-serif text-lg leading-relaxed text-foreground">This page is private.</p>
        <p className="font-mono text-xs theme-muted">
          open it with a signed share link, then enter the PIN if asked
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={verifyShareAccess} className="border theme-border rounded-md p-5 space-y-3">
      <p className="font-mono text-xs tracking-wide uppercase theme-muted">private page</p>
      <p className="font-serif text-lg leading-relaxed text-foreground">
        {pinRequired
          ? "Enter the share PIN to continue."
          : "Use this signed link to unlock access."}
      </p>
      {pinRequired ? (
        <label htmlFor="private-word-pin" className="block">
          <span className="font-mono text-xs theme-muted">share PIN</span>
          <input
            id="private-word-pin"
            name="pin"
            type="password"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value);
              setError("");
            }}
            placeholder="enter share PIN"
            autoComplete="one-time-code"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "private-word-pin-error" : undefined}
            className="mt-1 min-h-11 w-full bg-transparent border-b theme-border outline-none font-mono text-base sm:text-sm py-2"
          />
        </label>
      ) : null}
      {error ? (
        <p
          id="private-word-pin-error"
          role="alert"
          aria-live="polite"
          className="font-mono text-xs text-[var(--prose-hashtag)]"
        >
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={checking || (pinRequired && pin.trim().length === 0)}
        className="inline-flex min-h-11 items-center font-mono text-xs px-3 rounded border theme-border hover:bg-[var(--stone-100)] dark:hover:bg-[var(--stone-900)] transition-colors disabled:opacity-60"
      >
        {checking ? "unlocking..." : pinRequired ? "unlock with PIN" : "retry unlock"}
      </button>
    </form>
  );
}
