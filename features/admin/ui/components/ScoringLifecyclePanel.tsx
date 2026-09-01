import { useEffect, useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import {
  eventLocalInputToIso,
  isoToEventLocalInput,
} from "@/features/event-operations/night-schedule";
import type { EventRecord } from "@/features/events/types";
import type { ScoringAction, ScoringData } from "./event-scoring-types";
import { AdminStatus, adminToneForStatus } from "./AdminStatus";

export function ScoringLifecyclePanel({
  data,
  event,
  onAction,
}: {
  data: ScoringData;
  event?: EventRecord;
  onAction: ScoringAction;
}) {
  const [visibility, setVisibility] = useState(data.settings.leaderboardVisibility);
  const [gamesOpenAt, setGamesOpenAt] = useState("");
  const [gamesCloseAt, setGamesCloseAt] = useState("");
  const [scheduledStart, setScheduledStart] = useState("");
  const [scheduledFreeze, setScheduledFreeze] = useState("");
  const [scheduledEnd, setScheduledEnd] = useState("");
  const [prizeSlots, setPrizeSlots] = useState(3);
  const [reason, setReason] = useState("");
  const timeZone = event?.timezone ?? "Europe/London";

  useEffect(() => {
    setVisibility(data.settings.leaderboardVisibility);
    setGamesOpenAt(isoToEventLocalInput(data.settings.gamesOpenAt, timeZone));
    setGamesCloseAt(isoToEventLocalInput(data.settings.gamesCloseAt, timeZone));
    setScheduledStart(isoToEventLocalInput(data.settings.scheduledStart, timeZone));
    setScheduledFreeze(isoToEventLocalInput(data.settings.scheduledFreeze, timeZone));
    setScheduledEnd(isoToEventLocalInput(data.settings.scheduledEnd, timeZone));
  }, [data.settings, timeZone]);

  const instant = (value: string) => (value ? eventLocalInputToIso(value, timeZone) : null);

  return (
    <section aria-labelledby="scoring-lifecycle-heading" className="border-t theme-border pt-6">
      <h4 id="scoring-lifecycle-heading" className="font-serif text-xl">
        Night schedule and final board
      </h4>
      <p className="mt-2 max-w-2xl font-mono text-xs leading-relaxed theme-muted">
        One schedule for this event. Included pooled games inherit the game window unless a pool has
        its own override. Times below are shown in {timeZone}.
      </p>
      <AdminStatus
        tone={
          data.settings.state === "frozen" ? "attention" : adminToneForStatus(data.settings.state)
        }
        className="mt-2 font-mono text-xs"
      >
        scoring {data.settings.state}
      </AdminStatus>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            void onAction({
              action: "settings",
              leaderboardVisibility: visibility,
              gamesOpenAt: instant(gamesOpenAt),
              gamesCloseAt: instant(gamesCloseAt),
              scheduledStart: instant(scheduledStart),
              scheduledFreeze: instant(scheduledFreeze),
              scheduledEnd: instant(scheduledEnd),
            });
          } catch (error) {
            window.alert(error instanceof Error ? error.message : "Choose valid event times");
          }
        }}
        className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
      >
        <ScheduleField label="games open" value={gamesOpenAt} onChange={setGamesOpenAt} />
        <ScheduleField label="games close" value={gamesCloseAt} onChange={setGamesCloseAt} />
        <ScheduleField label="scoring opens" value={scheduledStart} onChange={setScheduledStart} />
        <ScheduleField
          label="leaderboard freezes"
          value={scheduledFreeze}
          onChange={setScheduledFreeze}
        />
        <ScheduleField label="event closes" value={scheduledEnd} onChange={setScheduledEnd} />
        <label className="font-mono text-xs">
          leaderboard before opening
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
        <button className="mh-action mh-action--primary self-end">save schedule</button>
      </form>
      {data.held.length > 0 && (
        <div className="mt-5">
          <AdminStatus tone="attention" className="font-mono text-xs">
            {data.held.length} held {data.held.length === 1 ? "action" : "actions"}
          </AdminStatus>
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
            <AdminStatus tone="attention" className="font-mono text-xs">
              {data.heldOfficialResults.length} held game{" "}
              {data.heldOfficialResults.length === 1 ? "result" : "results"}
            </AdminStatus>
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

function ScheduleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="font-mono text-xs">
      {label}
      <input
        type="datetime-local"
        step={60}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
      />
    </label>
  );
}
