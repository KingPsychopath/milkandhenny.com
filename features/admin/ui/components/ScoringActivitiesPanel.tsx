import { useState } from "react";

import { AppSelect } from "@/components/AppSelect";
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
  personalTemplates,
  onAction,
}: {
  activities: AdminScoringActivity[];
  personalTemplates: Array<{
    id: string;
    name: string;
    activityTemplate: string;
    rule: AdminScoringActivity["rule"];
  }>;
  onAction: ScoringAction;
}) {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<(typeof TEMPLATES)[number]>("winner");
  const [points, setPoints] = useState(5);
  const [repeat, setRepeat] = useState<"once" | "repeat" | "once-per-source">("repeat");
  const [requiresCheckIn, setRequiresCheckIn] = useState(true);
  const [expectedAttendance, setExpectedAttendance] = useState(100);
  const [starterTemplateId, setStarterTemplateId] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [previewId, setPreviewId] = useState("");

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
        {personalTemplates.length > 0 && (
          <label className="font-mono text-xs sm:col-span-2">
            personal templates
            <AppSelect
              value=""
              onValueChange={(value) => {
                if (!value) return;
                void onAction({
                  action: "create-from-activity-template",
                  templateId: value,
                });
              }}
              options={[
                { value: "", label: "Choose a saved template" },
                ...personalTemplates.map((item) => ({ value: item.id, label: item.name })),
              ]}
              variant="field"
              ariaLabel="Personal template"
              className="mt-2"
            />
          </label>
        )}
        <label className="font-mono text-xs sm:col-span-2">
          start from a template
          <AppSelect
            value={starterTemplateId}
            onValueChange={(value) => {
              setStarterTemplateId(value);
              const selected = EVENT_SCORING_TEMPLATES.find((item) => item.id === value);
              if (!selected || selected.kind !== "activity") return;
              setName(selected.label);
              setTemplate(selected.activityTemplate as typeof template);
              setPoints(selected.rule.fixedPoints ?? selected.rule.participationPoints ?? 5);
              setRepeat(selected.rule.repeat);
              setRequiresCheckIn(selected.rule.requiresCheckIn);
            }}
            options={[
              { value: "", label: "Blank activity" },
              ...EVENT_SCORING_TEMPLATES.filter((item) => item.kind === "activity").map((item) => ({
                value: item.id,
                label: item.label,
              })),
            ]}
            variant="field"
            ariaLabel="Activity template"
            className="mt-2"
          />
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
          <AppSelect
            value={template}
            onValueChange={(value) => setTemplate(value as typeof template)}
            options={TEMPLATES.map((value) => ({
              value,
              label: value.replaceAll("-", " "),
            }))}
            variant="field"
            ariaLabel="Activity outcome"
            className="mt-2"
          />
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
            <AppSelect
              value={repeat}
              onValueChange={(value) => setRepeat(value as typeof repeat)}
              options={[
                { value: "repeat", label: "each distinct result" },
                { value: "once", label: "once per participant" },
                { value: "once-per-source", label: "once per result source" },
              ]}
              variant="field"
              ariaLabel="Repeat rule"
              className="mt-2"
            />
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
            <button
              type="button"
              onClick={() =>
                void onAction({ action: "save-activity-template", activityId: activity.id })
              }
              className="min-h-11 px-2 font-mono text-micro underline hover:opacity-70"
            >
              save template
            </button>
            <button
              type="button"
              aria-expanded={previewId === activity.id}
              onClick={() =>
                setPreviewId((current) => (current === activity.id ? "" : activity.id))
              }
              className="min-h-11 px-2 font-mono text-micro underline hover:opacity-70"
            >
              preview
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
            {previewId === activity.id && (
              <div className="w-full grid gap-4 border-t theme-border py-4 sm:grid-cols-2">
                <section aria-label="Attendee preview">
                  <p className="font-mono text-micro uppercase tracking-widest theme-muted">
                    attendee preview
                  </p>
                  <p className="mt-2 font-serif text-lg">{activity.name}</p>
                  <p className="mt-1 font-mono text-xs theme-muted">
                    Confirmed results award points once under the configured rule. Draft previews do
                    not change scores.
                  </p>
                </section>
                <section aria-label="Moderator preview">
                  <p className="font-mono text-micro uppercase tracking-widest theme-muted">
                    moderator preview
                  </p>
                  <button
                    type="button"
                    disabled
                    className="mt-2 min-h-11 w-full border theme-border px-4 text-left font-serif opacity-60"
                  >
                    Record {activity.template.replaceAll("-", " ")}
                  </button>
                  <p className="mt-1 font-mono text-xs theme-muted">
                    Preview only. No scan, pool, or ledger write is possible here.
                  </p>
                </section>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
