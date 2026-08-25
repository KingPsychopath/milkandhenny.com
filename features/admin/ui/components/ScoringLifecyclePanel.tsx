import { useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import type { ScoringAction, ScoringData } from "./event-scoring-types";

export function ScoringLifecyclePanel({
  data,
  onAction,
}: {
  data: ScoringData;
  onAction: ScoringAction;
}) {
  const [visibility, setVisibility] = useState(data.settings.leaderboardVisibility);
  const [scheduledStart, setScheduledStart] = useState("");
  const [scheduledEnd, setScheduledEnd] = useState("");
  const [prizeSlots, setPrizeSlots] = useState(3);
  const [reason, setReason] = useState("");

  return (
    <section aria-labelledby="scoring-lifecycle-heading" className="border-t theme-border pt-6">
      <h4 id="scoring-lifecycle-heading" className="font-serif text-xl">
        Schedule and final board
      </h4>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onAction({
            action: "settings",
            leaderboardVisibility: visibility,
            scheduledStart: scheduledStart || undefined,
            scheduledEnd: scheduledEnd || undefined,
          });
        }}
        className="mt-4 grid gap-4 sm:grid-cols-3"
      >
        <label className="font-mono text-xs">
          visibility
          <AppSelect
            value={visibility}
            onValueChange={setVisibility}
            options={[
              { value: "hidden", label: "hidden" },
              { value: "preview", label: "admin preview" },
              { value: "public-live", label: "public live" },
              { value: "public-final", label: "public final" },
            ]}
            variant="field"
            ariaLabel="Leaderboard visibility"
            className="mt-2"
          />
        </label>
        <label className="font-mono text-xs">
          scheduled start (ISO time with event offset)
          <input
            type="text"
            placeholder="2026-08-25T19:00:00+01:00"
            value={scheduledStart}
            onChange={(event) => setScheduledStart(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        <label className="font-mono text-xs">
          scheduled end (ISO time with event offset)
          <input
            type="text"
            placeholder="2026-08-25T23:00:00+01:00"
            value={scheduledEnd}
            onChange={(event) => setScheduledEnd(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        <button className="min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70">
          save schedule
        </button>
      </form>
      {data.held.length > 0 && (
        <div className="mt-5">
          <p className="font-mono text-xs">Held actions</p>
          <ul className="mt-2 divide-y theme-border border-y theme-border">
            {data.held.map((held) => (
              <li key={held.id} className="flex items-center justify-between gap-3 py-2">
                <span className="font-mono text-micro theme-muted">
                  {held.sourceType} · {new Date(held.createdAt).toLocaleString()}
                </span>
                <button
                  type="button"
                  onClick={() => void onAction({ action: "accept-held", transactionId: held.id })}
                  className="min-h-11 font-mono text-xs underline hover:opacity-70"
                >
                  accept
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.heldOfficialResults.length > 0 && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-xs">Held game results</p>
            <button
              type="button"
              onClick={() => void onAction({ action: "retry-official-results" })}
              className="min-h-11 border theme-border px-3 font-mono text-xs hover:opacity-70"
            >
              retry all
            </button>
          </div>
          <ul className="mt-2 divide-y theme-border border-y theme-border">
            {data.heldOfficialResults.map((result) => (
              <li key={result.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 font-mono text-micro theme-muted">
                  {result.gameKind} · {result.resultId} r{result.revision} ·{" "}
                  {new Date(result.ingestedAt).toLocaleString()}
                  {result.heldReason ? ` — ${result.heldReason}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    void onAction({ action: "retry-official-results", resultId: result.id })
                  }
                  className="min-h-11 shrink-0 font-mono text-xs underline hover:opacity-70"
                >
                  retry
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onAction({ action: "finalize", prizeSlots, reason, resolvedTies: false });
        }}
        className="mt-5 grid gap-4 sm:grid-cols-2"
      >
        <label className="font-mono text-xs">
          prize places
          <input
            type="number"
            min={1}
            required
            value={prizeSlots}
            onChange={(event) => setPrizeSlots(Number(event.target.value))}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        <label className="font-mono text-xs">
          finalization note
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        <button
          disabled={!["frozen", "closed"].includes(data.settings.state)}
          className="min-h-11 border border-foreground px-4 font-mono text-xs hover:opacity-70 disabled:opacity-40"
        >
          finalize leaderboard
        </button>
        <button
          type="button"
          onClick={() => void onAction({ action: "rebuild-projections" })}
          className="min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70"
        >
          rebuild score totals
        </button>
      </form>
    </section>
  );
}
