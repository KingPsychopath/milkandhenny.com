"use client";

import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";

import { scannerToPromptFor, type RememberedScanner } from "@/features/tickets/scanner-memory";

/**
 * "Back to scanning?" prompt.
 *
 * A helper who wanders off the scanner — follows a link, taps the site
 * logo, reopens the browser to the homepage — gets a one-tap way back
 * without asking the organiser to re-send anything. Shows only while a
 * recently used scanner is remembered on this device, never on the scanner
 * pages themselves, and stays dismissed for the rest of the session.
 */

const DISMISS_KEY = "mah-scanner-prompt-dismissed";

export function ScannerReturnPrompt() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [scanner, setScanner] = useState<RememberedScanner | null>(null);

  useEffect(() => {
    if (pathname.startsWith("/scan")) {
      setScanner(null);
      return;
    }
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // Session storage unavailable — prompt anyway rather than never.
    }
    setScanner(scannerToPromptFor());
  }, [pathname]);

  if (!scanner) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Dismissal just won't survive a reload.
    }
    setScanner(null);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl border theme-border-strong bg-background px-4 py-3 shadow-lg">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs text-foreground">
            Scanning at {scanner.eventTitle}?
          </p>
          <p className="truncate font-mono text-micro theme-muted">
            {scanner.station} · {scanner.label}
          </p>
        </div>
        <Link
          to="/scan/$token"
          params={{ token: scanner.token }}
          className="shrink-0 rounded-lg bg-foreground px-3 py-2 font-mono text-micro text-background"
        >
          open scanner
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss scanner prompt"
          className="shrink-0 min-h-9 min-w-9 rounded-lg font-mono text-sm theme-muted hover:text-foreground transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
