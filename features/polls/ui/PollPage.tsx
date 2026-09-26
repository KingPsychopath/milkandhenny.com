import { Link } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { devicePollVoteOptions, publicPollOptions } from "../polls.queries";
import { PollDistribution } from "./PollDistribution";
import { usePollVoteMutation } from "./usePollVoteMutation";

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

export function PollPage({ slug }: { slug: string }) {
  const { data: publicPoll } = useSuspenseQuery(publicPollOptions(slug));
  const [voterId, setVoterId] = useState<string | null>(null);
  const { data: deviceVote } = useQuery({
    ...devicePollVoteOptions(slug, voterId),
    enabled: Boolean(voterId),
  });
  const voteMutation = usePollVoteMutation(slug);
  const [selections, setSelections] = useState<string[]>([]);
  const [edited, setEdited] = useState(false);
  const poll = publicPoll
    ? { ...publicPoll, results: deviceVote?.results ?? publicPoll.results }
    : null;
  const results = poll?.results ?? null;

  useEffect(() => {
    setVoterId(existingDeviceVoterId(slug));
    setSelections([]);
    setEdited(false);
  }, [slug]);

  useEffect(() => {
    if (!edited && deviceVote) setSelections(deviceVote.selections);
  }, [deviceVote, edited]);

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
    setEdited(true);
    voteMutation.reset();
    setSelections((current) => {
      if (poll.selectionMode === "single") return [optionId];
      return checked ? [...current, optionId] : current.filter((id) => id !== optionId);
    });
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const nextVoterId = voterId ?? deviceVoterId(slug);
      const response = await voteMutation.mutateAsync({ voterId: nextVoterId, selections });
      setVoterId(nextVoterId);
      setSelections(response.selections);
      setEdited(false);
    } catch {
      // Query owns the error while the selected ballot remains editable.
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
          {voteMutation.isError ? (
            <p role="alert" className="mt-4 font-mono text-xs text-[var(--status-danger)]">
              {voteMutation.error instanceof Error
                ? voteMutation.error.message
                : "We could not save your vote. Try again."}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={voteMutation.isPending || selections.length === 0}
            className="mh-action mh-action--primary mt-6"
          >
            {voteMutation.isPending
              ? "saving…"
              : deviceVote && !edited
                ? "update my answer"
                : "show me the shape"}
          </button>
          {deviceVote && !edited ? (
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
      ) : poll.resultVisibility === "hidden" && deviceVote ? (
        <p className="py-9 font-serif text-lg theme-muted">
          Thank you. We’re keeping the answers private while we choose the date.
        </p>
      ) : null}
    </main>
  );
}
