"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Props = {
  slug: string;
  shareToken: string;
};

export function UnlockNoteClient({ slug, shareToken }: Props) {
  const [pin, setPin] = useState("");
  const [pinRequired, setPinRequired] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");

  const hasShare = useMemo(() => shareToken.trim().length > 0, [shareToken]);

  const verifyShareAccess = useCallback(
    async (pinValue?: string) => {
      if (!hasShare) return;
      setChecking(true);
      setError("");

      try {
        const res = await fetch("/api/notes/share/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug,
            token: shareToken,
            ...(pinValue ? { pin: pinValue } : {}),
          }),
        });

        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          pinRequired?: boolean;
        };

        if (!res.ok) {
          setPinRequired(!!data.pinRequired);
          setError(data.error ?? "Unable to unlock this page.");
          setChecked(true);
          return;
        }

        window.location.reload();
      } catch {
        setChecked(true);
        setError("Network error. Please try again.");
      } finally {
        setChecking(false);
      }
    },
    [hasShare, shareToken, slug]
  );

  useEffect(() => {
    if (!hasShare || checked) return;
    void verifyShareAccess();
  }, [checked, hasShare, verifyShareAccess]);

  if (!hasShare) {
    return (
      <div className="border theme-border rounded-md p-5 space-y-2">
        <p className="font-mono text-xs tracking-wide uppercase theme-muted">private page</p>
        <p className="font-serif text-lg leading-relaxed text-foreground">
          This page is private.
        </p>
        <p className="font-mono text-xs theme-muted">
          open it with a signed share link, then enter the PIN if asked
        </p>
      </div>
    );
  }

  return (
    <div className="border theme-border rounded-md p-5 space-y-3">
      <p className="font-mono text-xs tracking-wide uppercase theme-muted">
        private page
      </p>
      <p className="font-serif text-lg leading-relaxed text-foreground">
        {pinRequired
          ? "Enter the share PIN to continue."
          : checked
            ? "Use this signed link to unlock access."
            : "Checking share link..."}
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
              if (!checking) void verifyShareAccess(pin);
            }
          }}
          className="w-full bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
        />
      ) : null}
      {error ? <p className="font-mono text-xs text-[var(--prose-hashtag)]">{error}</p> : null}
      <button
        type="button"
        onClick={() => void verifyShareAccess(pinRequired ? pin : undefined)}
        disabled={checking || (!pinRequired && !checked) || (pinRequired && pin.trim().length === 0)}
        className="font-mono text-xs px-3 py-2 rounded border theme-border hover:bg-[var(--stone-100)] dark:hover:bg-[var(--stone-900)] transition-colors disabled:opacity-60"
      >
        {checking ? "unlocking..." : pinRequired ? "unlock with PIN" : "retry unlock"}
      </button>
    </div>
  );
}
