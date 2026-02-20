"use client";

import { useMemo, useState } from "react";

type Props = {
  slug: string;
  shareToken: string;
};

export function UnlockNoteClient({ slug, shareToken }: Props) {
  const [pin, setPin] = useState("");
  const [pinRequired, setPinRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const hasShare = useMemo(() => shareToken.trim().length > 0, [shareToken]);

  async function onUnlock() {
    if (!hasShare) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/notes/share/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          token: shareToken,
          ...(pin ? { pin } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        pinRequired?: boolean;
      };
      if (!res.ok) {
        setPinRequired(!!data.pinRequired);
        setError(data.error ?? "Unable to unlock this note.");
        return;
      }
      window.location.reload();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!hasShare) {
    return (
      <div className="border theme-border rounded-md p-4 font-mono text-sm theme-muted">
        This note is private. Open it using a signed share URL.
      </div>
    );
  }

  return (
    <div className="border theme-border rounded-md p-4 space-y-3">
      <p className="font-mono text-sm theme-muted">
        Private note access required.
      </p>
      {pinRequired && (
        <input
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="enter share PIN"
          className="w-full bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
        />
      )}
      {error ? <p className="font-mono text-xs text-red-500">{error}</p> : null}
      <button
        type="button"
        onClick={() => void onUnlock()}
        disabled={loading}
        className="font-mono text-xs px-3 py-2 rounded border theme-border hover:bg-[var(--stone-100)] dark:hover:bg-[var(--stone-900)] transition-colors disabled:opacity-60"
      >
        {loading ? "unlocking..." : "unlock note"}
      </button>
    </div>
  );
}
