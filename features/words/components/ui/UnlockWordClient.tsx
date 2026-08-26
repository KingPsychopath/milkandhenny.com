import { useState } from "react";
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

  async function verifyShareAccess() {
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
    <div className="border theme-border rounded-md p-5 space-y-3">
      <p className="font-mono text-xs tracking-wide uppercase theme-muted">private page</p>
      <p className="font-serif text-lg leading-relaxed text-foreground">
        {pinRequired
          ? "Enter the share PIN to continue."
          : "Use this signed link to unlock access."}
      </p>
      {pinRequired ? (
        <input
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="enter share PIN"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (!checking) void verifyShareAccess();
            }
          }}
          className="w-full bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
        />
      ) : null}
      {error ? <p className="font-mono text-xs text-[var(--prose-hashtag)]">{error}</p> : null}
      <button
        type="button"
        onClick={() => void verifyShareAccess()}
        disabled={checking || (pinRequired && pin.trim().length === 0)}
        className="font-mono text-xs px-3 py-2 rounded border theme-border hover:bg-[var(--stone-100)] dark:hover:bg-[var(--stone-900)] transition-colors disabled:opacity-60"
      >
        {checking ? "unlocking..." : pinRequired ? "unlock with PIN" : "retry unlock"}
      </button>
    </div>
  );
}
