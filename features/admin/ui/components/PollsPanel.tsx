"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AppSelect } from "@/components/AppSelect";
import { PollDistribution } from "@/features/polls/ui/PollDistribution";
import type { AdminPoll, PollOption, PollRecord } from "@/features/polls/types";
import { AdminLoadError, AdminLoading } from "./AdminLoadState";
import { AdminStatus, adminToneForStatus } from "./AdminStatus";

type PollDraft = Omit<AdminPoll, "results" | "responseCount" | "createdAt" | "updatedAt">;
type EventOption = { slug: string; title: string };
type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

const WEEKDAYS: PollOption[] = [
  { id: "monday", label: "Monday" },
  { id: "tuesday", label: "Tuesday" },
  { id: "wednesday", label: "Wednesday" },
  { id: "thursday", label: "Thursday" },
  { id: "friday", label: "Friday" },
  { id: "saturday", label: "Saturday" },
  { id: "sunday", label: "Sunday" },
];

const EMPTY_DRAFT: PollDraft = {
  id: "",
  slug: "",
  eventSlug: null,
  title: "",
  intro: "",
  question: "",
  options: [],
  selectionMode: "single",
  resultVisibility: "after_vote",
  showPercentages: false,
  status: "draft",
};

function Field({
  label,
  value,
  onChange,
  rows,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  const classes =
    "mt-2 w-full rounded border theme-border bg-transparent px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]";
  return (
    <label className="block">
      <span className="font-mono text-micro theme-muted">{label}</span>
      {rows ? (
        <textarea
          rows={rows}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={classes}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${classes} min-h-11`}
        />
      )}
    </label>
  );
}

export function PollsPanel({
  authFetch,
  events,
  onError,
  onStatus,
}: {
  authFetch: AuthFetch;
  events: EventOption[];
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const [polls, setPolls] = useState<AdminPoll[]>([]);
  const [draft, setDraft] = useState<PollDraft>(EMPTY_DRAFT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await authFetch("/api/admin/polls");
      const data = (await response.json().catch(() => ({}))) as {
        polls?: AdminPoll[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Could not load polls");
      setPolls(data.polls ?? []);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not load polls";
      setLoadError(message);
      onError(message);
    } finally {
      setLoading(false);
    }
  }, [authFetch, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectPoll = (poll: AdminPoll) => {
    setSelectedId(poll.id);
    const {
      results: _results,
      responseCount: _responseCount,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...editable
    } = poll;
    setDraft(editable);
  };

  const newWeekdayPoll = () => {
    setSelectedId(null);
    setDraft({
      ...EMPTY_DRAFT,
      slug: "after-school-club-monthly-day",
      title: "Which night should After School Club live on?",
      intro:
        "We’re aiming to make After School Club a monthly thing, most likely on the second Tuesday or Wednesday of each month. Before we settle into that rhythm, tell us which evening would genuinely suit you best.",
      question: "If you could choose one evening, which would it be?",
      options: WEEKDAYS,
      status: "open",
    });
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await authFetch("/api/admin/polls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = (await response.json().catch(() => ({}))) as {
        poll?: AdminPoll;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Could not save poll");
      if (data.poll) {
        setSelectedId(data.poll.id);
        selectPoll(data.poll);
      }
      onStatus("Poll saved.");
      await load();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not save poll");
    } finally {
      setBusy(false);
    }
  };

  const selected = polls.find((poll) => poll.id === selectedId);
  return (
    <section aria-labelledby="polls-heading" className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
            poll studio
          </p>
          <h3 id="polls-heading" className="mt-2 font-serif text-3xl tracking-tight">
            A quick read of the room
          </h3>
          <p className="mt-3 max-w-2xl font-serif text-lg leading-relaxed theme-muted">
            Create reusable public polls, choose when people see the collective answer, and inspect
            exact results here.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="mh-action mh-action--secondary"
            onClick={() => {
              setSelectedId(null);
              setDraft(EMPTY_DRAFT);
            }}
          >
            new poll
          </button>
          <button type="button" className="mh-action mh-action--primary" onClick={newWeekdayPoll}>
            new weekday poll
          </button>
        </div>
      </div>

      {loading && polls.length === 0 ? <AdminLoading label="Loading polls…" /> : null}
      {loadError ? <AdminLoadError message={loadError} retry={() => void load()} /> : null}
      <div className="grid gap-8 lg:grid-cols-[.8fr_1.2fr]">
        <div className="border-y theme-border">
          {polls.length ? (
            polls.map((poll) => (
              <button
                key={poll.id}
                type="button"
                onClick={() => selectPoll(poll)}
                className={`block w-full border-b theme-border-faint px-2 py-4 text-left last:border-0 ${selectedId === poll.id ? "bg-[var(--selection-bg)]" : ""}`}
              >
                <span className="font-serif text-xl">{poll.title}</span>
                <span className="mt-1 flex items-center gap-2 font-mono text-micro theme-muted">
                  {poll.responseCount} responses{" "}
                  <AdminStatus tone={adminToneForStatus(poll.status)}>{poll.status}</AdminStatus>
                </span>
              </button>
            ))
          ) : !loading ? (
            <p className="py-5 font-mono text-xs theme-muted">No polls yet.</p>
          ) : null}
        </div>
        <div className="space-y-8">
          {selected ? (
            <section aria-labelledby="admin-poll-results" className="border-y theme-border py-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h4 id="admin-poll-results" className="font-mono text-xs font-bold">
                    live results
                  </h4>
                  <p className="mt-1 font-mono text-micro theme-muted">
                    {selected.responseCount} completed ballots
                  </p>
                </div>
                <a
                  href={`/polls/${selected.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mh-action mh-action--quiet"
                >
                  open public poll →
                </a>
              </div>
              <div className="mt-6">
                <PollDistribution results={selected.results} showPercentages showCounts />
              </div>
            </section>
          ) : null}

          <form onSubmit={save} className="space-y-4 border-t theme-border pt-6">
            <p className="font-mono text-sm font-bold">{draft.id ? "edit poll" : "new poll"}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="title"
                value={draft.title}
                onChange={(title) => setDraft((current) => ({ ...current, title }))}
              />
              <Field
                label="slug"
                value={draft.slug}
                onChange={(slug) => setDraft((current) => ({ ...current, slug }))}
              />
            </div>
            <Field
              label="intro"
              rows={4}
              value={draft.intro}
              onChange={(intro) => setDraft((current) => ({ ...current, intro }))}
            />
            <Field
              label="question"
              value={draft.question}
              onChange={(question) => setDraft((current) => ({ ...current, question }))}
            />
            <Field
              label="choices — one per line"
              rows={7}
              value={draft.options.map((option) => option.label).join("\n")}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  options: value
                    .split("\n")
                    .map((label, index) => ({ id: current.options[index]?.id ?? label, label })),
                }))
              }
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="font-mono text-micro theme-muted">event (optional)</span>
                <AppSelect
                  value={draft.eventSlug ?? ""}
                  onValueChange={(eventSlug) =>
                    setDraft((current) => ({ ...current, eventSlug: eventSlug || null }))
                  }
                  options={[
                    { value: "", label: "standalone poll" },
                    ...events.map((event) => ({ value: event.slug, label: event.title })),
                  ]}
                  ariaLabel="event (optional)"
                  variant="field"
                  className="mt-2"
                />
              </label>
              <label className="block">
                <span className="font-mono text-micro theme-muted">status</span>
                <AppSelect
                  value={draft.status}
                  onValueChange={(status) =>
                    setDraft((current) => ({ ...current, status: status as PollRecord["status"] }))
                  }
                  options={["draft", "open", "closed", "archived"].map((value) => ({
                    value,
                    label: value,
                  }))}
                  ariaLabel="status"
                  variant="field"
                  className="mt-2"
                />
              </label>
              <label className="block">
                <span className="font-mono text-micro theme-muted">answer shape</span>
                <AppSelect
                  value={draft.selectionMode}
                  onValueChange={(selectionMode) =>
                    setDraft((current) => ({
                      ...current,
                      selectionMode: selectionMode as PollRecord["selectionMode"],
                    }))
                  }
                  options={[
                    { value: "single", label: "choose one" },
                    { value: "multiple", label: "choose several" },
                  ]}
                  ariaLabel="answer shape"
                  variant="field"
                  className="mt-2"
                />
              </label>
              <label className="block">
                <span className="font-mono text-micro theme-muted">public results</span>
                <AppSelect
                  value={draft.resultVisibility}
                  onValueChange={(resultVisibility) =>
                    setDraft((current) => ({
                      ...current,
                      resultVisibility: resultVisibility as PollRecord["resultVisibility"],
                    }))
                  }
                  options={[
                    { value: "after_vote", label: "after voting" },
                    { value: "always", label: "always visible" },
                    { value: "hidden", label: "hidden" },
                  ]}
                  ariaLabel="public results"
                  variant="field"
                  className="mt-2"
                />
              </label>
            </div>
            <label className="flex min-h-11 items-center gap-3 font-mono text-xs">
              <input
                type="checkbox"
                checked={draft.showPercentages}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, showPercentages: event.target.checked }))
                }
              />{" "}
              show exact percentages publicly
            </label>
            <button
              type="submit"
              disabled={busy || !draft.title || !draft.question || draft.options.length < 2}
              className="mh-action mh-action--primary"
            >
              {busy ? "saving…" : "save poll"}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
