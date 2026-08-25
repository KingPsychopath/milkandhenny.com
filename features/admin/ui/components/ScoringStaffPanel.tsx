import { useState } from "react";

import type {
  AdminScoringActivity,
  AdminStaffAssignment,
  ScoringAction,
} from "./event-scoring-types";

const PRESETS = [
  "game-moderator",
  "points-marshal",
  "activity-manager",
  "event-manager",
  "admin",
] as const;

const PERMISSIONS = [
  "viewParticipantPoints",
  "awardPoints",
  "runActivities",
  "transferPoints",
  "reverseAwards",
  "reviewHeldActions",
  "manageActivities",
  "manageDiscoveries",
  "uploadActivityPhotos",
  "manageStaffAndPools",
  "resolveIdentity",
  "finalizeLeaderboard",
] as const;

const HIGH_RISK = new Set([
  "transferPoints",
  "reverseAwards",
  "reviewHeldActions",
  "manageStaffAndPools",
  "resolveIdentity",
  "finalizeLeaderboard",
]);

export function ScoringStaffPanel({
  eventSlug,
  activities,
  staff,
  onAction,
}: {
  eventSlug: string;
  activities: AdminScoringActivity[];
  staff: AdminStaffAssignment[];
  onAction: ScoringAction;
}) {
  const [label, setLabel] = useState("");
  const [assignmentType, setAssignmentType] = useState<"personal" | "station">("personal");
  const [preset, setPreset] = useState<(typeof PRESETS)[number]>("points-marshal");
  const [activityIds, setActivityIds] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState("");
  const [poolPoints, setPoolPoints] = useState(50);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [issuedUrl, setIssuedUrl] = useState("");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (
      Object.entries(overrides).some(
        ([permission, enabled]) => enabled && HIGH_RISK.has(permission),
      )
    ) {
      if (
        !window.confirm(
          "This link includes high-risk event controls. Create it only for a trusted manager.",
        )
      )
        return;
    }
    const body = await onAction({
      action: "create-staff",
      label,
      assignmentType,
      preset,
      overrides,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      scope: { activityIds, largeAwardWarningAt: 25 },
    });
    const assignment = body?.assignment as { id?: string; token?: string } | undefined;
    if (!assignment?.id || !assignment.token) return;
    if (poolPoints > 0) {
      await onAction({
        action: "issue-pool",
        ownerType: assignmentType === "station" ? "station" : "staff",
        ownerId: assignment.id,
        points: poolPoints,
      });
    }
    setIssuedUrl(
      `${window.location.origin}/events/${encodeURIComponent(eventSlug)}/staff/${assignment.token}`,
    );
    setLabel("");
  }

  return (
    <section aria-labelledby="scoring-staff-heading" className="border-t theme-border pt-6">
      <h4 id="scoring-staff-heading" className="font-serif text-xl">
        Staff access
      </h4>
      <form onSubmit={(event) => void create(event)} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="font-mono text-xs">
          label
          <input
            required
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        <label className="font-mono text-xs">
          access type
          <select
            value={assignmentType}
            onChange={(event) => setAssignmentType(event.target.value as typeof assignmentType)}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          >
            <option value="personal">personal link</option>
            <option value="station">shared station</option>
          </select>
        </label>
        <label className="font-mono text-xs">
          preset
          <select
            value={preset}
            onChange={(event) => setPreset(event.target.value as typeof preset)}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          >
            {PRESETS.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("-", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="font-mono text-xs">
          expires
          <input
            type="datetime-local"
            required
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        <label className="font-mono text-xs">
          point pool
          <input
            type="number"
            min={0}
            value={poolPoints}
            onChange={(event) => setPoolPoints(Number(event.target.value))}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        <fieldset className="sm:col-span-2">
          <legend className="font-mono text-xs">activity scope</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {activities
              .filter((activity) => activity.status === "live")
              .map((activity) => (
                <label
                  key={activity.id}
                  className="flex min-h-11 items-center gap-2 font-mono text-xs"
                >
                  <input
                    type="checkbox"
                    checked={activityIds.includes(activity.id)}
                    onChange={(event) =>
                      setActivityIds((current) =>
                        event.target.checked
                          ? [...current, activity.id]
                          : current.filter((id) => id !== activity.id),
                      )
                    }
                  />
                  {activity.name}
                </label>
              ))}
          </div>
        </fieldset>
        <details className="sm:col-span-2">
          <summary className="min-h-11 cursor-pointer font-mono text-xs">
            adjust preset permissions
          </summary>
          <div className="grid gap-2 sm:grid-cols-2">
            {PERMISSIONS.map((permission) => (
              <label
                key={permission}
                className="flex min-h-11 items-center gap-2 font-mono text-xs"
              >
                <input
                  type="checkbox"
                  checked={overrides[permission] ?? false}
                  onChange={(event) =>
                    setOverrides((current) => ({ ...current, [permission]: event.target.checked }))
                  }
                />
                {permission.replace(/([A-Z])/g, " $1").toLowerCase()}
                {HIGH_RISK.has(permission) ? " — high risk" : ""}
              </label>
            ))}
          </div>
        </details>
        <button className="min-h-11 border border-foreground px-4 font-mono text-xs hover:opacity-70">
          create staff link
        </button>
      </form>
      {issuedUrl && (
        <div className="mt-5 border-y theme-border py-4" role="status">
          <p className="font-mono text-xs">Copy this link now. It is shown once.</p>
          <input
            readOnly
            value={issuedUrl}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3 font-mono text-xs"
          />
        </div>
      )}
      <ul className="mt-5 divide-y theme-border border-y theme-border">
        {staff.map((assignment) => (
          <li key={assignment.id} className="py-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1 font-serif">{assignment.label}</span>
              <span className="font-mono text-micro theme-muted">
                {assignment.assignmentType} · {assignment.status}
              </span>
              {assignment.status === "active" && (
                <button
                  type="button"
                  onClick={() =>
                    void onAction({ action: "revoke-staff", assignmentId: assignment.id })
                  }
                  className="min-h-11 font-mono text-micro underline hover:opacity-70"
                >
                  revoke link
                </button>
              )}
            </div>
            {assignment.devices
              .filter((device) => !device.revokedAt)
              .map((device, index) => (
                <div
                  key={device.deviceId}
                  className="mt-2 flex items-center justify-between gap-3 pl-4 font-mono text-micro theme-muted"
                >
                  <span>
                    device {index + 1} · last used {new Date(device.lastSeenAt).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      void onAction({
                        action: "revoke-staff-device",
                        assignmentId: assignment.id,
                        deviceId: device.deviceId,
                      })
                    }
                    className="min-h-11 underline hover:opacity-70"
                  >
                    revoke device
                  </button>
                </div>
              ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
