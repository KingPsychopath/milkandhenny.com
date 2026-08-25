import { useState } from "react";

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
