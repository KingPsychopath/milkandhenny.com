import { useRef, useState } from "react";

import { CameraFeed } from "@/features/tickets/ui/CameraFeed";
import {
  awardStaffPointsFn,
  resolveStaffScannedParticipantFn,
  searchStaffParticipantsFn,
} from "../staff-scoring.functions";
import type { getStaffScoringPage } from "../staff-scoring.server";
import { convertRulePoints } from "../types";

type PageData = Extract<Awaited<ReturnType<typeof getStaffScoringPage>>, { found: true }>;
type Participant = Awaited<ReturnType<typeof searchStaffParticipantsFn>>[number];

export function StaffScoringPage({ data, token }: { data: PageData; token: string }) {
  const [activityId, setActivityId] = useState(data.activities[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Participant[]>([]);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [scanned, setScanned] = useState("");
  const [placement, setPlacement] = useState(1);
  const [rawScore, setRawScore] = useState(0);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [reviewReady, setReviewReady] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [confirmedRemaining, setConfirmedRemaining] = useState<number | undefined>();
  const commandId = useRef(crypto.randomUUID());

  const activity = data.activities.find((entry) => entry.id === activityId);
  const pool = data.pools.find((entry) => entry.activityId === activityId) ?? data.pools[0];
  const previewPoints = activity ? convertRulePoints(activity.rule, { placement, rawScore }) : 0;

  async function search() {
    if (query.trim().length < 2) {
      setError("Enter at least two letters or a ticket suffix.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setResults(
        await searchStaffParticipantsFn({
          data: { eventSlug: data.eventSlug, token, term: query },
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function award(confirmLarge = false) {
    if (!activityId || !participant) {
      setError("Choose an activity and a participant.");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    const result = await awardStaffPointsFn({
      data: {
        eventSlug: data.eventSlug,
        token,
        activityId,
        participantId: participant.id,
        placement,
        rawScore,
        commandId: commandId.current,
        note: note.trim() || undefined,
        confirmLarge,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setNeedsConfirmation(result.status === 409 && result.error.startsWith("Confirm this"));
      return;
    }
    setStatus(`${result.value.points} points awarded.`);
    setConfirmedRemaining(result.value.remainingPool);
    setNeedsConfirmation(false);
    setReviewReady(false);
    setParticipant(null);
    setScanned("");
    setQuery("");
    setResults([]);
    setNote("");
    commandId.current = crypto.randomUUID();
  }

  async function resolveScan(raw = scanned) {
    if (!raw.trim()) {
      setError("Paste or scan a ticket first.");
      return;
    }
    setBusy(true);
    setError("");
    const found = await resolveStaffScannedParticipantFn({
      data: { eventSlug: data.eventSlug, token, scanned: raw },
    });
    setBusy(false);
    if (!found) {
      setError("This ticket is not valid for this event.");
      return;
    }
    setParticipant(found);
    setResults([]);
    setQuery("");
    setReviewReady(false);
    setCameraOpen(false);
  }

  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-10">
      <header>
        <p className="font-mono text-micro uppercase tracking-widest theme-muted">staff scoring</p>
        <h1 className="mt-2 font-serif text-3xl text-foreground">{data.eventTitle}</h1>
        <p className="mt-2 font-mono text-xs theme-muted">{data.label}</p>
      </header>

      {!data.canAward ? (
        <p className="mt-10 border-y theme-border py-6 font-serif text-lg">
          This staff link has no scoring actions.
        </p>
      ) : data.activities.length === 0 ? (
        <p className="mt-10 border-y theme-border py-6 font-serif text-lg">
          No assigned activity is accepting results.
        </p>
      ) : (
        <section aria-labelledby="award-heading" className="mt-10 border-t theme-border pt-7">
          <h2 id="award-heading" className="font-serif text-2xl">
            Award points
          </h2>
          <div className="mt-6 space-y-6">
            <label className="block font-mono text-xs">
              activity
              <select
                value={activityId}
                onChange={(event) => {
                  setActivityId(event.target.value);
                  setReviewReady(false);
                  setNeedsConfirmation(false);
                  setConfirmedRemaining(undefined);
                }}
                className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
              >
                {data.activities.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>

            {(activity?.rule.mode === "placement" || activity?.rule.mode === "diminishing") && (
              <label className="block font-mono text-xs">
                place
                <input
                  type="number"
                  min={1}
                  value={placement}
                  onChange={(event) => {
                    setPlacement(Number(event.target.value));
                    setReviewReady(false);
                  }}
                  className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
                />
              </label>
            )}

            {activity?.rule.mode === "raw-normalized" && (
              <label className="block font-mono text-xs">
                result
                <input
                  type="number"
                  min={0}
                  value={rawScore}
                  onChange={(event) => {
                    setRawScore(Number(event.target.value));
                    setReviewReady(false);
                  }}
                  className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
                />
              </label>
            )}

            <div>
              <p className="font-mono text-xs">find participant</p>
              <form
                className="mt-2 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void search();
                }}
              >
                <label htmlFor="staff-participant-search" className="sr-only">
                  Name, alias, or ticket suffix
                </label>
                <input
                  id="staff-participant-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="name, alias, or ticket suffix"
                  className="min-h-11 min-w-0 flex-1 border theme-border bg-transparent px-3 font-mono text-xs"
                />
                <button
                  disabled={busy}
                  className="min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70 disabled:opacity-50"
                >
                  search
                </button>
              </form>
              {results.length > 0 && (
                <ul className="mt-2 divide-y theme-border border-y theme-border">
                  {results.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setParticipant(entry);
                          setResults([]);
                          setScanned("");
                          setReviewReady(false);
                          setNeedsConfirmation(false);
                        }}
                        className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left hover:opacity-70"
                      >
                        <span className="font-serif">{entry.displayName ?? entry.publicAlias}</span>
                        <span className="font-mono text-micro theme-muted">
                          {entry.balance} points
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <label htmlFor="staff-ticket-scan" className="block font-mono text-xs">
                or paste a scanned ticket
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="staff-ticket-scan"
                  value={scanned}
                  onChange={(event) => {
                    setScanned(event.target.value);
                    setParticipant(null);
                    setReviewReady(false);
                  }}
                  className="min-h-11 min-w-0 flex-1 border theme-border bg-transparent px-3"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void resolveScan()}
                  className="min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70 disabled:opacity-50"
                >
                  use ticket
                </button>
              </div>
              <button
                type="button"
                onClick={() => setCameraOpen((current) => !current)}
                className="mt-3 min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70"
              >
                {cameraOpen ? "close camera" : "scan with camera"}
              </button>
              {cameraOpen && (
                <div className="mt-3 max-w-sm">
                  <CameraFeed
                    paused={busy || participant !== null}
                    onCode={(raw) => {
                      setScanned(raw);
                      void resolveScan(raw);
                    }}
                  />
                </div>
              )}
            </div>

            {participant && reviewReady && (
              <div className="border-y theme-border py-4" aria-live="polite">
                <p className="font-serif text-lg">
                  {participant.displayName ?? participant.publicAlias}
                </p>
                <p className="mt-1 font-mono text-xs theme-muted">
                  {activity?.name} · {previewPoints} points · {participant.balance} current points
                  {pool
                    ? ` · ${confirmedRemaining ?? pool.available} confirmed pool points left`
                    : ""}
                </p>
              </div>
            )}

            <label className="block font-mono text-xs">
              {activity?.template === "free-form"
                ? "note (required for a free-form award)"
                : "note (optional for configured outcomes)"}
              <input
                required={activity?.template === "free-form"}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
              />
            </label>

            {error && (
              <p role="alert" className="font-mono text-xs text-red-700 dark:text-red-300">
                {error}
              </p>
            )}
            {status && (
              <p role="status" className="font-mono text-xs">
                {status}
              </p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!reviewReady) {
                  if (!participant) setError("Choose a participant first.");
                  else {
                    setError("");
                    setReviewReady(true);
                  }
                  return;
                }
                void award(needsConfirmation);
              }}
              className="min-h-11 border border-foreground px-5 font-mono text-xs hover:opacity-70 disabled:opacity-50"
            >
              {needsConfirmation
                ? "confirm large award"
                : reviewReady
                  ? "award points"
                  : "review award"}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
