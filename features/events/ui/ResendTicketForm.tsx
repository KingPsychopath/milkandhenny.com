"use client";

import { useId, useState } from "react";

import { resendTicketsFn } from "@/features/tickets/tickets.functions";
import { useBrowserProfileForm } from "@/lib/client/browser-profile";
import { BrowserProfileHint } from "@/components/BrowserProfileHint";
import { EmailAddressNotice } from "@/components/EmailAddressNotice";

/**
 * "Send my ticket again."
 *
 * Someone always deletes the email. The response is identical whether or not
 * the address matched, so this cannot be used to test who is attending.
 */
export function ResendTicketForm({ eventSlug }: { eventSlug: string }) {
  const emailId = useId();
  const { email, setEmail, remember } = useBrowserProfileForm();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState("sending");
    try {
      const result = await resendTicketsFn({ data: { eventSlug, email } });
      if (result.ok) remember({ email });
      setState(result.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  };

  if (state === "sent") {
    return (
      <p className="font-mono text-micro theme-muted leading-relaxed">
        If we have a ticket for that address, it&apos;s on its way. Check spam.
      </p>
    );
  }

  return (
    <details className="group">
      <summary className="min-h-11 content-center cursor-pointer font-mono text-micro theme-muted tracking-wide hover:text-foreground transition-colors">
        already have a ticket but lost the email?
      </summary>
      <form onSubmit={submit} className="mt-3">
        <div className="flex gap-2">
          <label htmlFor={emailId} className="sr-only">
            Email address
          </label>
          <input
            id={emailId}
            name="email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
            placeholder="you@example.com"
            className="min-h-11 min-w-0 flex-1 px-3 font-mono text-sm bg-transparent border theme-border rounded-lg text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
          />
          <button
            type="submit"
            disabled={state === "sending"}
            className="min-h-11 px-4 font-mono text-xs border theme-border-strong rounded-lg text-foreground disabled:opacity-50 hover:opacity-70 transition-opacity"
          >
            {state === "sending" ? "sending" : "send"}
          </button>
        </div>
        <EmailAddressNotice email={email} onAcceptSuggestion={setEmail} />
      </form>
      <div className="mt-2">
        <BrowserProfileHint />
      </div>
      {state === "error" && (
        <p role="alert" className="mt-2 font-mono text-micro theme-muted">
          That didn&apos;t work. Check the address and try again.
        </p>
      )}
    </details>
  );
}
