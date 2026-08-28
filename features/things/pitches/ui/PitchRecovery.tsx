import { useState } from "react";

import { useBrowserProfileForm } from "@/lib/client/browser-profile";
import { BrowserProfileHint } from "@/components/BrowserProfileHint";
import { EmailAddressNotice } from "@/components/EmailAddressNotice";
import { recoverPitchAccessFn } from "../pitches.functions";

export function PitchRecovery({ compact = false }: { compact?: boolean }) {
  const { email, setEmail, remember } = useBrowserProfileForm();
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");
    try {
      const result = await recoverPitchAccessFn({ data: { email } });
      if (!result.ok) {
        setStatus("error");
        setMessage(result.error);
        return;
      }
      remember({ email });
      setStatus("sent");
    } catch {
      setStatus("error");
      setMessage("Could not send the link. Try again.");
    }
  }

  if (status === "sent") {
    return (
      <p className="font-mono text-sm leading-relaxed theme-muted" role="status">
        If that address owns any pitches, one email with every private link is on the way.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className={compact ? "" : "border-t theme-border pt-8"}>
      <label className="block font-mono text-xs uppercase tracking-[0.14em] theme-muted">
        Recover my pitches
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="mt-3 block min-h-12 w-full border-b theme-border-strong bg-transparent px-0 font-mono text-base text-foreground outline-none focus:border-foreground"
        />
      </label>
      <EmailAddressNotice email={email} onAcceptSuggestion={setEmail} />
      <div className="mt-2">
        <BrowserProfileHint />
      </div>
      <p className="mt-3 font-mono text-micro leading-relaxed theme-muted">
        One email brings back every active pitch registered to that address.
      </p>
      <button
        type="submit"
        disabled={status === "sending"}
        className="mt-5 min-h-11 border-b theme-border-strong font-mono text-sm text-foreground hover:opacity-60 disabled:opacity-40"
      >
        {status === "sending" ? "sending…" : "email my private links →"}
      </button>
      {status === "error" ? (
        <p className="mt-3 font-mono text-xs text-red-700 dark:text-red-300" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  );
}
