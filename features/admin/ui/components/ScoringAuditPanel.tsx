import { useState } from "react";

import type { AdminScoringActivity, ScoringData } from "./event-scoring-types";

export function ScoringAuditPanel({
  audit,
  anomalies,
  activities,
  onFilter,
  onExport,
}: {
  audit: ScoringData["audit"];
  anomalies: ScoringData["anomalies"];
  activities: AdminScoringActivity[];
  onFilter: (filter: Record<string, string>) => Promise<void>;
  onExport: () => Promise<void>;
}) {
  const [participant, setParticipant] = useState("");
  const [actor, setActor] = useState("");
  const [activity, setActivity] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  return (
    <section aria-labelledby="scoring-audit-heading" className="border-t theme-border pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 id="scoring-audit-heading" className="font-serif text-xl">
            Audit and export
          </h4>
          <p className="mt-2 font-mono text-xs theme-muted">
            The export omits bearer credentials and includes the latest 500 audit events.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onExport()}
          className="min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70"
        >
          download export
        </button>
      </div>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          void onFilter(
            Object.fromEntries(
              Object.entries({
                auditParticipant: participant,
                auditActor: actor,
                auditActivity: activity,
                auditSource: source,
                auditStatus: status,
                auditFrom: from,
                auditTo: to,
              }).filter(([, value]) => value),
            ),
          );
        }}
      >
        <label className="font-mono text-xs">
          participant ID
          <input
            value={participant}
            onChange={(event) => setParticipant(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        <label className="font-mono text-xs">
          actor, assignment, station, or device
          <input
            value={actor}
            onChange={(event) => setActor(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        <label className="font-mono text-xs">
          activity
          <select
            value={activity}
            onChange={(event) => setActivity(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          >
            <option value="">all activities</option>
            {activities.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <label className="font-mono text-xs">
          source
          <select
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          >
            <option value="">all sources</option>
            {["manual", "game", "discovery", "check-in", "transfer", "reversal", "correction"].map(
              (entry) => (
                <option key={entry}>{entry}</option>
              ),
            )}
          </select>
        </label>
        <label className="font-mono text-xs">
          status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          >
            <option value="">all states</option>
            {["accepted", "held", "rejected", "reversed"].map((entry) => (
              <option key={entry}>{entry}</option>
            ))}
          </select>
        </label>
        <label className="font-mono text-xs">
          from
          <input
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        <label className="font-mono text-xs">
          to
          <input
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        <button className="min-h-11 self-end border theme-border px-4 font-mono text-xs hover:opacity-70">
          filter audit
        </button>
      </form>
      <ol className="mt-4 max-h-80 divide-y theme-border overflow-y-auto border-y theme-border">
        {audit.map((entry) => (
          <li
            key={entry.id}
            className="grid gap-1 py-3 font-mono text-micro sm:grid-cols-[1fr_auto]"
          >
            <span>
              {entry.action} · {entry.entityType}
            </span>
            <time className="theme-muted" dateTime={entry.createdAt}>
              {new Date(entry.createdAt).toLocaleString()}
            </time>
            <span className="theme-muted">
              actor: {entry.actorType}
              {entry.actorId ? ` (${entry.actorId})` : ""}
            </span>
          </li>
        ))}
      </ol>
      {anomalies.length > 0 && (
        <div className="mt-5">
          <h5 className="font-serif text-lg">Signals for human review</h5>
          <p className="mt-1 font-mono text-xs theme-muted">
            Signals are context only. They do not accuse a guest or merge identity.
          </p>
          <ol className="mt-3 divide-y theme-border border-y theme-border">
            {anomalies.map((entry) => (
              <li key={entry.id} className="py-3 font-mono text-micro">
                <span>
                  {entry.signal} · {entry.state}
                </span>
                <span className="ml-3 theme-muted">
                  {entry.assignmentId ?? entry.stationId ?? entry.actorId ?? "system"}
                  {entry.deviceId ? ` · device ${entry.deviceId}` : ""}
                  {entry.activityId ? ` · activity ${entry.activityId}` : ""}
                  {` · ${new Date(entry.createdAt).toLocaleString()}`}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
