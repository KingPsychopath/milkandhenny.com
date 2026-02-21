"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { WordBody } from "./WordBody";
import type { WordMeta } from "@/features/words/content-types";

type Props = {
  slug: string;
};

export function UnlockWordClient({ slug }: Props) {
  const searchParams = useSearchParams();
  const shareToken = searchParams.get("share") ?? "";
  const [pin, setPin] = useState("");
  const [pinRequired, setPinRequired] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");
  const [unlocked, setUnlocked] = useState<{ meta: WordMeta; markdown: string } | null>(null);

  const hasShare = useMemo(() => shareToken.trim().length > 0, [shareToken]);

  const loadUnlockedWord = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/words/${encodeURIComponent(slug)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return false;
      const data = (await res.json().catch(() => null)) as {
        meta?: WordMeta;
        markdown?: string;
      } | null;
      if (!data?.meta || typeof data.markdown !== "string") return false;
      setUnlocked({ meta: data.meta, markdown: data.markdown });
      return true;
    } catch {
      return false;
    }
  }, [slug]);

  const verifyShareAccess = useCallback(
    async (pinValue?: string) => {
      if (!hasShare) return;
      setChecking(true);
      setError("");

      try {
        const res = await fetch("/api/words/share/verify", {
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

        const didLoad = await loadUnlockedWord();
        if (!didLoad) {
          setError("Unlocked, but this page could not be loaded. Please retry.");
        } else {
          setChecked(true);
        }
      } catch {
        setChecked(true);
        setError("Network error. Please try again.");
      } finally {
        setChecking(false);
      }
    },
    [hasShare, loadUnlockedWord, shareToken, slug]
  );

  useEffect(() => {
    if (checked) return;
    let cancelled = false;
    (async () => {
      const canLoadExisting = await loadUnlockedWord();
      if (cancelled) return;
      if (canLoadExisting) {
        setChecked(true);
        return;
      }
      if (hasShare) {
        await verifyShareAccess();
        if (!cancelled) setChecked(true);
        return;
      }
      setChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [checked, hasShare, loadUnlockedWord, verifyShareAccess]);

  if (unlocked) {
    return (
      <div className="space-y-8">
        <header className="space-y-3">
          <div className="font-mono text-xs uppercase tracking-wide theme-muted">private</div>
          <h2 className="font-serif text-2xl text-foreground leading-tight">{unlocked.meta.title}</h2>
          {unlocked.meta.subtitle ? (
            <p className="font-serif theme-subtle text-base leading-relaxed">{unlocked.meta.subtitle}</p>
          ) : null}
        </header>
        <WordBody content={unlocked.markdown} wordSlug={slug} />
      </div>
    );
  }

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
