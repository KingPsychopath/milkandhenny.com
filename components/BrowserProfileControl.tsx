"use client";

import { useState } from "react";

import { useBrowserProfile } from "@/lib/client/browser-profile";

export function BrowserProfileControl() {
  const { loaded, profile, forget } = useBrowserProfile();
  const [message, setMessage] = useState("");
  const hasSavedDetails = Object.values(profile).some(Boolean);

  if (!loaded) return null;

  return (
    <div className="mt-5 border-t theme-border pt-5">
      <p className="font-mono text-sm theme-muted">
        {hasSavedDetails
          ? "This browser has saved profile suggestions."
          : "This browser has no saved profile suggestions."}
      </p>
      <button
        type="button"
        disabled={!hasSavedDetails}
        onClick={() => {
          setMessage(
            forget()
              ? "The saved profile suggestions were removed from this browser."
              : "The browser could not remove the saved details.",
          );
        }}
        className="mt-4 min-h-11 border-b theme-border-strong font-mono text-sm text-foreground hover:opacity-60 disabled:opacity-40"
      >
        forget saved details
      </button>
      {message ? (
        <p className="mt-3 font-mono text-sm theme-muted" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
