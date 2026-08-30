import { useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import type { AdminScoringActivity, ScoringAction } from "./event-scoring-types";
import { AdminStatus, adminToneForStatus } from "./AdminStatus";

type Participant = { id: string; displayName?: string; publicAlias: string; balance: number };

export function ScoringCorrectionsPanel({
  eventSlug,
  state,
  activities,
  authFetch,
  onAction,
}: {
  eventSlug: string;
  state: string;
  activities: AdminScoringActivity[];
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  onAction: ScoringAction;
}) {
  const [term, setTerm] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [activityId, setActivityId] = useState(activities[0]?.id ?? "");
  const [points, setPoints] = useState(1);
  const [note, setNote] = useState("");

  async function search(event: React.FormEvent) {
    event.preventDefault();
    const response = await authFetch(
      `/api/admin/events/${encodeURIComponent(eventSlug)}/scoring?participant=${encodeURIComponent(term)}`,
    );
    const body = (await response.json()) as { participants?: Participant[] };
    setParticipants(body.participants ?? []);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!participant || !activityId || !note.trim()) return;
    if (state === "closed") {
      if (
        !window.confirm(
          "This changes a closed score and makes the final leaderboard provisional. Continue?",
        )
      )
        return;
      await onAction({
        action: "closed-correction",
        activityId,
        participantId: participant.id,
        delta: points,
        note,
        confirmed: true,
        idempotencyKey: crypto.randomUUID(),
      });
    } else {
      await onAction({
        action: "penalty",
        activityId,
        participantId: participant.id,
        points: Math.abs(points),
        note,
        idempotencyKey: crypto.randomUUID(),
      });
    }
    setNote("");
  }

  return (
    <section aria-labelledby="score-corrections-heading" className="border-t theme-border pt-6">
      <h4 id="score-corrections-heading" className="font-serif text-xl">
        Penalties and corrections
      </h4>
      <AdminStatus
        tone={state === "frozen" ? "attention" : adminToneForStatus(state)}
        className="mt-2 font-mono text-xs"
      >
        scoring {state}
      </AdminStatus>
      <form onSubmit={(event) => void search(event)} className="mt-4 flex gap-2">
        <label htmlFor="admin-score-participant" className="sr-only">
          Participant name, alias, or ticket suffix
        </label>
        <input
          id="admin-score-participant"
          required
          minLength={2}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="name, alias, or ticket suffix"
          className="min-h-11 min-w-0 flex-1 border theme-border bg-transparent px-3 font-mono text-xs"
        />
        <button className="min-h-11 border theme-border px-3 font-mono text-xs hover:opacity-70">
          search
        </button>
      </form>
      {participants.length > 0 && (
        <ul className="mt-2 divide-y theme-border border-y theme-border">
          {participants.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => {
                  setParticipant(entry);
                  setParticipants([]);
                }}
                className="flex min-h-11 w-full items-center justify-between py-2 text-left hover:opacity-70"
              >
                <span className="font-serif">{entry.displayName ?? entry.publicAlias}</span>
                <span className="font-mono text-micro theme-muted">{entry.balance} points</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {participant && (
        <form onSubmit={(event) => void submit(event)} className="mt-4 grid gap-4 sm:grid-cols-2">
          <p className="font-serif sm:col-span-2">
            {participant.displayName ?? participant.publicAlias} · {participant.balance} points
          </p>
          <label className="font-mono text-xs">
            source activity
            <AppSelect
              value={activityId}
              onValueChange={setActivityId}
              options={activities.map((activity) => ({
                value: activity.id,
                label: activity.name,
              }))}
              variant="field"
              ariaLabel="Source activity"
              className="mt-2"
            />
          </label>
          <label className="font-mono text-xs">
            {state === "closed" ? "point change (positive or negative)" : "penalty points"}
            <input
              type="number"
              required
              value={points}
              onChange={(event) => setPoints(Number(event.target.value))}
              className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
            />
          </label>
          <label className="font-mono text-xs sm:col-span-2">
            reason
            <input
              required
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
            />
          </label>
          <button className="min-h-11 border border-foreground px-4 font-mono text-xs hover:opacity-70">
            {state === "closed" ? "review closed correction" : "apply penalty"}
          </button>
        </form>
      )}
    </section>
  );
}
