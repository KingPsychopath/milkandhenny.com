import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { getPollVoteFn, submitPollVoteFn } from "../polls.functions";
import type { PollResult, PublicPoll } from "../types";
import { PollDistribution } from "./PollDistribution";

function deviceVoterId(slug: string): string {
  const key = `milk-henny:poll:${slug}:voter`;
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(key, created);
  return created;
}

function existingDeviceVoterId(slug: string): string | null {
  return window.localStorage.getItem(`milk-henny:poll:${slug}:voter`);
}

export function PollPage({ initialPoll }: { initialPoll: PublicPoll | null }) {
  const [poll, setPoll] = useState(initialPoll);
  const [selections, setSelections] = useState<string[]>([]);
  const [results, setResults] = useState<PollResult[] | null>(initialPoll?.results ?? null);
  const [state, setState] = useState<"ready" | "saving" | "saved" | "error">("ready");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!initialPoll || initialPoll.results) return;
    const voterId = existingDeviceVoterId(initialPoll.slug);
    if (!voterId) return;
    let current = true;
    void getPollVoteFn({ data: { slug: initialPoll.slug, voterId } })
      .then((vote) => {
        if (!current || !vote) return;
        setPoll({ ...vote.poll, results: vote.results });
        setSelections(vote.selections);
        setResults(vote.results);
        setState("saved");
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [initialPoll]);

  if (!poll) {
    return (
      <main id="main" className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-6 py-14">
        <Link to="/" className="inline-flex min-h-11 items-center font-mono text-micro theme-muted">
          ← milk &amp; henny
        </Link>
        <section className="my-auto border-y theme-border py-10">
          <p className="font-mono text-micro uppercase tracking-widest theme-muted">
            a small question
          </p>
          <h1 className="mt-4 font-serif text-4xl tracking-tight">This poll has gone quiet.</h1>
          <p className="mt-5 font-serif text-lg leading-relaxed theme-muted">
            It is not available right now.
          </p>
        </section>
      </main>
    );
  }

  const choose = (optionId: string, checked: boolean) => {
    setState("ready");
    setError("");
    setSelections((current) => {
      if (poll.selectionMode === "single") return [optionId];
      return checked ? [...current, optionId] : current.filter((id) => id !== optionId);
    });
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState("saving");
    setError("");
    try {
      const response = await submitPollVoteFn({
        data: { slug: poll.slug, voterId: deviceVoterId(poll.slug), selections },
      });
      setPoll({ ...response.poll, results: response.results });
      setSelections(response.selections);
      setResults(response.results);
      setState("saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not save your vote. Try again.");
      setState("error");
    }
  };

  return (
    <main id="main" className="mx-auto min-h-dvh w-full max-w-2xl px-6 py-14 text-foreground">
      <Link to="/" className="inline-flex min-h-11 items-center font-mono text-micro theme-muted">
        ← milk &amp; henny
      </Link>
      <header className="border-b theme-border pb-8 pt-10">
        <p className="font-mono text-micro uppercase tracking-widest theme-muted">
          milk &amp; henny · the next one
        </p>
        <h1 className="mt-4 font-serif text-4xl leading-tight tracking-tight sm:text-5xl">
          {poll.title}
        </h1>
        <p className="mt-5 max-w-xl font-serif text-lg leading-relaxed theme-muted">{poll.intro}</p>
      </header>

      {poll.status === "open" ? (
        <form onSubmit={submit} className="border-b theme-border py-9">
          <fieldset>
            <legend className="font-serif text-2xl leading-snug">{poll.question}</legend>
            <p className="mt-2 font-mono text-micro theme-muted">
              {poll.selectionMode === "single" ? "Choose one." : "Choose every option that works."}
            </p>
            <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {poll.options.map((option) => {
                const checked = selections.includes(option.id);
                return (
                  <label key={option.id} className="cursor-pointer">
                    <input
                      className="peer sr-only"
                      type={poll.selectionMode === "single" ? "radio" : "checkbox"}
                      name="poll-choice"
                      value={option.id}
                      checked={checked}
                      onChange={(event) => choose(option.id, event.target.checked)}
                    />
                    <span className="flex min-h-14 items-center justify-center rounded-lg border theme-border-strong px-3 text-center font-mono text-sm transition-opacity hover:opacity-70 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--prose-hashtag)] peer-checked:bg-foreground peer-checked:text-background">
                      {option.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {state === "error" ? (
            <p role="alert" className="mt-4 font-mono text-xs text-[var(--status-danger)]">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={state === "saving" || selections.length === 0}
            className="mh-action mh-action--primary mt-6"
          >
            {state === "saving"
              ? "saving…"
              : state === "saved"
                ? "update my answer"
                : "show me the shape"}
          </button>
          {state === "saved" ? (
            <p role="status" className="mt-3 font-mono text-xs theme-muted">
              Your answer is in. You can change it above.
            </p>
          ) : null}
        </form>
      ) : (
        <p className="border-b theme-border py-8 font-serif text-lg theme-muted">
          Voting has closed. Thank you for helping us choose.
        </p>
      )}

      {results ? (
        <section aria-labelledby="poll-results-heading" className="py-10">
          <p className="font-mono text-micro uppercase tracking-widest theme-muted">
            what the room is leaning towards
          </p>
          <h2 id="poll-results-heading" className="mt-3 font-serif text-3xl tracking-tight">
            The shape so far
          </h2>
          <p className="mt-3 max-w-xl font-serif leading-relaxed theme-muted">
            Taller columns mean more people chose that day. This is a live preference, not a final
            date.
          </p>
          <div className="mt-8">
            <PollDistribution results={results} showPercentages={poll.showPercentages} />
          </div>
        </section>
      ) : poll.resultVisibility === "hidden" && state === "saved" ? (
        <p className="py-9 font-serif text-lg theme-muted">
          Thank you. We’re keeping the answers private while we choose the date.
        </p>
      ) : null}
    </main>
  );
}
