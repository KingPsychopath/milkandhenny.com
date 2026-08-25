import { useState } from "react";

import { EVENT_SCORING_TEMPLATES, estimateMaximumIssue } from "@/features/event-scoring/templates";
import type { AdminScoringActivity, ScoringAction } from "./event-scoring-types";

const TEMPLATES = [
  "winner",
  "placement",
  "participation",
  "completion",
  "team-result",
  "audience-vote",
  "scan-to-award",
  "free-form",
  "check-in",
  "discovery",
] as const;

export function ScoringActivitiesPanel({
  activities,
  onAction,
}: {
  activities: AdminScoringActivity[];
  onAction: ScoringAction;
}) {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<(typeof TEMPLATES)[number]>("winner");
  const [points, setPoints] = useState(5);
  const [repeat, setRepeat] = useState<"once" | "repeat" | "once-per-source">("repeat");
  const [requiresCheckIn, setRequiresCheckIn] = useState(true);
  const [expectedAttendance, setExpectedAttendance] = useState(100);
  const [advanced, setAdvanced] = useState(false);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const created = await onAction({
      action: "create-activity",
      name,
      template,
      status: "live",
      rule: {
        mode:
          template === "placement"
            ? "placement"
            : template === "participation"
              ? "participation"
              : "fixed",
        fixedPoints: points,
        participationPoints: points,
        placementPoints: {
          "1": points,
          "2": Math.max(1, points - 2),
          "3": Math.max(1, points - 4),
        },
        repeat,
        requiresCheckIn,
      },
    });
    if (created) setName("");
  }

  return (
    <section aria-labelledby="scoring-activities-heading" className="border-t theme-border pt-6">
      <h4 id="scoring-activities-heading" className="font-serif text-xl">
        Activities
      </h4>
      <form onSubmit={(event) => void create(event)} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="font-mono text-xs sm:col-span-2">
          start from a template
          <select
            defaultValue=""
            onChange={(event) => {
              const selected = EVENT_SCORING_TEMPLATES.find(
                (item) => item.id === event.target.value,
              );
              if (!selected || selected.kind !== "activity") return;
              setName(selected.label);
              setTemplate(selected.activityTemplate as typeof template);
              setPoints(selected.rule.fixedPoints ?? selected.rule.participationPoints ?? 5);
              setRepeat(selected.rule.repeat);
              setRequiresCheckIn(selected.rule.requiresCheckIn);
            }}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          >
            <option value="">Blank activity</option>
            {EVENT_SCORING_TEMPLATES.filter((item) => item.kind === "activity").map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="font-mono text-xs">
          name
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        <label className="font-mono text-xs">
          outcome
          <select
            value={template}
            onChange={(event) => setTemplate(event.target.value as typeof template)}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          >
            {TEMPLATES.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("-", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="font-mono text-xs">
          winner or completion points
          <input
            type="number"
            min={1}
            required
            value={points}
            onChange={(event) => setPoints(Number(event.target.value))}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        <label className="font-mono text-xs">
          expected attendance
          <input
            type="number"
            min={1}
            value={expectedAttendance}
            onChange={(event) => setExpectedAttendance(Number(event.target.value))}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
          <span className="mt-2 block theme-muted">
            Estimated maximum:{" "}
            {estimateMaximumIssue({
              rule: { mode: "fixed", fixedPoints: points, repeat, requiresCheckIn },
              expectedAttendance,
            }) ?? "not bounded"}{" "}
            points
          </span>
        </label>
        <button
          type="button"
          onClick={() => setAdvanced((value) => !value)}
          aria-expanded={advanced}
          className="min-h-11 text-left font-mono text-xs underline hover:opacity-70"
        >
          {advanced ? "hide advanced settings" : "show advanced settings"}
        </button>
        {advanced && (
          <label className="font-mono text-xs">
            repeat rule
            <select
              value={repeat}
              onChange={(event) => setRepeat(event.target.value as typeof repeat)}
              className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
            >
              <option value="repeat">each distinct result</option>
              <option value="once">once per participant</option>
              <option value="once-per-source">once per result source</option>
            </select>
          </label>
        )}
        <label className="flex min-h-11 items-center gap-3 font-mono text-xs">
          <input
            type="checkbox"
            checked={requiresCheckIn}
            onChange={(event) => setRequiresCheckIn(event.target.checked)}
          />
          require event check-in
        </label>
        <button className="min-h-11 border border-foreground px-4 font-mono text-xs hover:opacity-70">
          create live activity
        </button>
      </form>
      <ul className="mt-5 divide-y theme-border border-y theme-border">
        {activities.map((activity) => (
          <li key={activity.id} className="flex flex-wrap items-center gap-3 py-3">
            <span className="min-w-0 flex-1 font-serif">{activity.name}</span>
            <span className="font-mono text-micro theme-muted">{activity.status}</span>
            <button
              type="button"
              onClick={() => void onAction({ action: "copy-activity", activityId: activity.id })}
              className="min-h-11 px-2 font-mono text-micro underline hover:opacity-70"
            >
              copy
            </button>
            {(["live", "paused"].includes(activity.status)
              ? [activity.status === "live" ? "paused" : "live", "ended", "cancelled"]
              : []
            ).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() =>
                  void onAction({ action: "update-activity", activityId: activity.id, status })
                }
                className="min-h-11 px-2 font-mono text-micro underline hover:opacity-70"
              >
                {status}
              </button>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
