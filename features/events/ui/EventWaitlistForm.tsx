"use client";

import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";

import { AppSelect } from "@/components/AppSelect";
import { EmailAddressNotice } from "@/components/EmailAddressNotice";
import { requestEventWaitlistFn } from "@/features/event-waitlist/waitlist.functions";
import type { WaitlistScope } from "@/features/event-waitlist/types";

export interface EventWaitlistOption {
  value: string;
  label: string;
  scope: WaitlistScope;
}

type WaitlistFormState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "done" }
  | { status: "error"; message: string };

export function EventWaitlistForm({
  eventSlug,
  options,
}: {
  eventSlug: string;
  options: EventWaitlistOption[];
}) {
  const emailId = useId();
  const scopeId = useId();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState(options[0]?.value ?? "");
  const [state, setState] = useState<WaitlistFormState>({ status: "idle" });

  if (options.length === 0) return null;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const option = options.find((candidate) => candidate.value === selected) ?? options[0];
    if (!option) return;
    setState({ status: "submitting" });
    try {
      const result = await requestEventWaitlistFn({
        data: { eventSlug, email, scope: option.scope },
      });
      if (!result.ok) {
        setState({ status: "error", message: result.error });
        return;
      }
      setState({ status: "done" });
    } catch {
      setState({ status: "error", message: "We could not join the waitlist. Try again." });
    }
  };

  return (
    <section className="mt-8 border-y theme-border py-6" aria-labelledby={`${scopeId}-heading`}>
      <p className="font-mono text-micro uppercase tracking-widest theme-muted">waitlist</p>
      <h3 id={`${scopeId}-heading`} className="mt-2 font-serif text-2xl text-foreground">
        Hear when a place opens up
      </h3>
      <p className="mt-2 font-serif text-sm leading-relaxed theme-subtle">
        Choose what you want and we&apos;ll send one alert when availability increases. Tickets are
        not held by the alert.
      </p>

      {state.status === "done" ? (
        <div className="mt-5" role="status">
          <p className="font-serif text-base text-foreground">Check your inbox to confirm.</p>
          <p className="mt-2 font-mono text-micro leading-relaxed theme-muted">
            If you already confirmed a place for this event, it stays active. No marketing signup is
            added.
          </p>
          <button
            type="button"
            onClick={() => setState({ status: "idle" })}
            className="mt-3 min-h-11 font-mono text-micro underline underline-offset-4 hover:opacity-70"
          >
            use another email
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-5 space-y-4">
          {options.length > 1 ? (
            <div>
              <label htmlFor={scopeId} className="font-mono text-micro tracking-wide theme-muted">
                alert me about
              </label>
              <AppSelect
                id={scopeId}
                value={selected}
                onValueChange={setSelected}
                options={options.map((option) => ({ value: option.value, label: option.label }))}
                variant="field"
                className="mt-1"
              />
            </div>
          ) : (
            <p className="font-mono text-xs text-foreground">{options[0]?.label}</p>
          )}

          <div>
            <label htmlFor={emailId} className="font-mono text-micro tracking-wide theme-muted">
              email for the alert
            </label>
            <input
              id={emailId}
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (state.status === "error") setState({ status: "idle" });
              }}
              aria-invalid={state.status === "error" ? true : undefined}
              aria-describedby={state.status === "error" ? errorId : undefined}
              className="mt-1 min-h-12 w-full rounded-lg border theme-border-strong bg-transparent px-4 font-mono text-base text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
            />
            <EmailAddressNotice email={email} onAcceptSuggestion={setEmail} />
          </div>

          {state.status === "error" ? (
            <p id={errorId} role="alert" className="font-mono text-xs text-[var(--admin-danger)]">
              {state.message}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={state.status === "submitting"}
            className="mh-action mh-action--primary w-full disabled:opacity-50"
          >
            {state.status === "submitting" ? "joining…" : "email me when tickets open"}
          </button>
          <p className="font-mono text-micro leading-relaxed theme-faint">
            Confirming opts into this one service alert only. See our{" "}
            <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">
              privacy notice
            </Link>
            .
          </p>
        </form>
      )}
    </section>
  );
}
