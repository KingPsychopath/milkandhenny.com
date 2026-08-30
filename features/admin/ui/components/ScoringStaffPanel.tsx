import { useState } from "react";

import { AppImage } from "@/components/AppImage";
import { AppSelect } from "@/components/AppSelect";
import { EmailAddressNotice } from "@/components/EmailAddressNotice";
import { useQrCode } from "@/hooks/useQrCode";
import type {
  AdminScoringActivity,
  AdminStaffAssignment,
  ScoringAction,
} from "./event-scoring-types";
import { AdminStatus, adminToneForStatus } from "./AdminStatus";

const PRESETS = [
  "door-scanner",
  "door-manager",
  "game-moderator",
  "points-marshal",
  "activity-manager",
  "event-manager",
  "admin",
] as const;

const PRESET_DESCRIPTIONS: Record<(typeof PRESETS)[number], string> = {
  "door-scanner": "Checks guests in. Cannot add guests or change points.",
  "door-manager": "Checks guests in and handles door guest requests.",
  "game-moderator": "Runs activities and records their winners or results.",
  "points-marshal": "Records manual awards and sees participant points.",
  "activity-manager": "Runs, configures, and scores event activities.",
  "event-manager": "Operates the event, including corrections and staff access.",
  admin: "Full event authority, including identity and final leaderboard controls.",
};

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
  const [recipientEmail, setRecipientEmail] = useState("");
  const [assignmentType, setAssignmentType] = useState<"personal" | "station">("personal");
  const [preset, setPreset] = useState<(typeof PRESETS)[number]>("points-marshal");
  const [activityIds, setActivityIds] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState("");
  const [poolPoints, setPoolPoints] = useState(50);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [issuedUrl, setIssuedUrl] = useState("");
  const [issuedMessage, setIssuedMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [reason, setReason] = useState("");
  const { dataUrl: issuedQr, failed: issuedQrFailed } = useQrCode(issuedUrl || null, 320);

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
      recipientEmail: assignmentType === "personal" ? recipientEmail : undefined,
      assignmentType,
      preset,
      reason,
      overrides,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      scope: { activityIds, largeAwardWarningAt: 25 },
    });
    const assignment = body?.assignment as { id?: string; token?: string } | undefined;
    if (!assignment?.id) return;
    if (poolPoints > 0) {
      await onAction({
        action: "issue-pool",
        ownerType: assignmentType === "station" ? "station" : "staff",
        ownerId: assignment.id,
        points: poolPoints,
      });
    }
    if (assignment.token) {
      setIssuedUrl(
        `${window.location.origin}/events/${encodeURIComponent(eventSlug)}/staff/${assignment.token}`,
      );
      setIssuedMessage("Copy this station link now. It is shown once.");
      setCopyMessage("");
    } else {
      setIssuedUrl("");
      setIssuedMessage("The personal invitation was queued for the verified email.");
    }
    setLabel("");
    setRecipientEmail("");
    setReason("");
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
          reason
          <input
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        {assignmentType === "personal" ? (
          <div>
            <label className="font-mono text-xs">
              verified email
              <input
                type="email"
                required
                autoComplete="email"
                value={recipientEmail}
                onChange={(event) => setRecipientEmail(event.target.value)}
                className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
              />
              <span className="mt-2 block leading-relaxed theme-muted">
                Access activates only after the one-time invitation reaches this mailbox.
              </span>
            </label>
            <EmailAddressNotice email={recipientEmail} onAcceptSuggestion={setRecipientEmail} />
          </div>
        ) : null}
        <label className="font-mono text-xs">
          access type
          <AppSelect
            value={assignmentType}
            onValueChange={(value) => setAssignmentType(value as typeof assignmentType)}
            options={[
              { value: "personal", label: "personal link" },
              { value: "station", label: "shared station" },
            ]}
            variant="field"
            ariaLabel="Access type"
            className="mt-2"
          />
          <span className="mt-2 block leading-relaxed theme-muted">
            {assignmentType === "personal"
              ? "Tied to one durable staff identity."
              : "Shared by the station, not treated as one person."}
          </span>
        </label>
        <label className="font-mono text-xs">
          preset
          <AppSelect
            value={preset}
            onValueChange={(value) => setPreset(value as typeof preset)}
            options={PRESETS.map((value) => ({
              value,
              label: value.replaceAll("-", " "),
            }))}
            variant="field"
            ariaLabel="Access preset"
            className="mt-2"
          />
          <span className="mt-2 block leading-relaxed theme-muted">
            {PRESET_DESCRIPTIONS[preset]}
          </span>
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
      {issuedMessage ? (
        <div className="mt-5 border-y theme-border py-4" role="status">
          <AdminStatus tone={issuedUrl ? "attention" : "positive"} className="font-mono text-xs">
            {issuedMessage}
          </AdminStatus>
          {issuedUrl ? (
            <div>
              <input
                aria-label="New station access link"
                readOnly
                value={issuedUrl}
                onFocus={(event) => event.currentTarget.select()}
                className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3 font-mono text-xs"
              />
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (!navigator.clipboard) {
                      setCopyMessage("Copy is unavailable. Select the link above instead.");
                      return;
                    }
                    void navigator.clipboard
                      .writeText(issuedUrl)
                      .then(() => setCopyMessage("Station link copied."))
                      .catch(() => setCopyMessage("Copy failed. Select the link above instead."));
                  }}
                  className="min-h-11 border theme-border px-4 font-mono text-xs underline"
                >
                  copy station link
                </button>
                {issuedQr ? (
                  <a
                    href={issuedQr}
                    download={`${eventSlug}-staff-station-qr.png`}
                    className="inline-flex min-h-11 items-center font-mono text-xs underline"
                  >
                    download QR
                  </a>
                ) : null}
              </div>
              {copyMessage ? (
                <p className="mt-2 font-mono text-xs">
                  <AdminStatus
                    tone={copyMessage === "Station link copied." ? "positive" : "danger"}
                  >
                    {copyMessage}
                  </AdminStatus>
                </p>
              ) : null}
              {issuedQr ? (
                <AppImage
                  src={issuedQr}
                  alt="QR code for the new staff scoring station"
                  width={320}
                  height={320}
                  className="mt-4 size-48 bg-white p-1"
                />
              ) : issuedQrFailed ? (
                <AdminStatus tone="danger" className="mt-3 font-mono text-xs">
                  QR generation failed. Copy the station link instead
                </AdminStatus>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <ul className="mt-5 divide-y theme-border border-y theme-border">
        {staff.map((assignment) => (
          <li key={assignment.id} className="py-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1 font-serif">{assignment.label}</span>
              <span className="flex flex-wrap items-center gap-x-2 font-mono text-micro theme-muted">
                <span>
                  {String(assignment.scope.rolePreset ?? assignment.assignmentType).replaceAll(
                    "-",
                    " ",
                  )}
                </span>
                <span aria-hidden="true">·</span>
                <AdminStatus
                  tone={adminToneForStatus(assignment.invitationState ?? assignment.status)}
                >
                  {assignment.invitationState ?? assignment.status}
                </AdminStatus>
                {assignment.personId ? ` · person ${assignment.personId.slice(-6)}` : ""}
              </span>
              {assignment.status === "active" && (
                <button
                  type="button"
                  onClick={() =>
                    void (async () => {
                      const reason = window.prompt("Why are you revoking this access?")?.trim();
                      if (!reason) return;
                      await onAction({
                        action: "revoke-staff",
                        assignmentId: assignment.id,
                        reason,
                      });
                    })()
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
                    onClick={() => {
                      const reason = window
                        .prompt("Why are you revoking this staff device?")
                        ?.trim();
                      if (!reason) return;
                      void onAction({
                        action: "revoke-staff-device",
                        assignmentId: assignment.id,
                        deviceId: device.deviceId,
                        reason,
                      });
                    }}
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
