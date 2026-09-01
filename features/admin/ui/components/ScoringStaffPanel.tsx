import { useMemo, useState } from "react";

import { AppImage } from "@/components/AppImage";
import { AppSelect } from "@/components/AppSelect";
import { EmailAddressNotice } from "@/components/EmailAddressNotice";
import { useQrCode } from "@/hooks/useQrCode";
import type {
  AdminScoringActivity,
  AdminStaffAssignment,
  AdminStaffRole,
  ScoringAction,
} from "./event-scoring-types";
import { AdminStatus } from "./AdminStatus";
import { StaffRoleAccess } from "./StaffAccessRegister";

const PRESETS = [
  "door-scanner",
  "checkpoint-scanner",
  "door-manager",
  "game-moderator",
  "points-marshal",
  "activity-manager",
  "event-manager",
  "admin",
] as const;
type Preset = (typeof PRESETS)[number];
type Delivery = "email" | "copy" | "direct" | "station";

const PERMISSIONS = [
  "admitTickets",
  "scanCheckpoints",
  "viewParticipantPoints",
  "awardPoints",
  "manageTeams",
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
  "requestGuests",
  "addGuests",
  "approveRequests",
] as const;

const PRESET_PERMISSIONS: Record<Preset, readonly string[]> = {
  "door-scanner": ["admitTickets"],
  "checkpoint-scanner": ["scanCheckpoints"],
  "door-manager": ["admitTickets", "requestGuests", "addGuests", "approveRequests"],
  "game-moderator": ["runActivities", "viewParticipantPoints", "awardPoints", "manageTeams"],
  "points-marshal": ["viewParticipantPoints", "awardPoints"],
  "activity-manager": [
    "viewParticipantPoints",
    "awardPoints",
    "manageTeams",
    "runActivities",
    "manageActivities",
  ],
  "event-manager": PERMISSIONS.filter((permission) => permission !== "scanCheckpoints"),
  admin: PERMISSIONS,
};

const LABELS: Record<(typeof PERMISSIONS)[number], string> = {
  admitTickets: "check guests in at entry",
  scanCheckpoints: "scan ticket allowances at checkpoints",
  viewParticipantPoints: "find attendees and view points",
  awardPoints: "award points",
  manageTeams: "shuffle and move teams",
  runActivities: "run activities",
  transferPoints: "transfer points",
  reverseAwards: "undo awards",
  reviewHeldActions: "approve held scoring",
  manageActivities: "change activities",
  manageDiscoveries: "manage discoveries",
  uploadActivityPhotos: "attach activity photos",
  manageStaffAndPools: "manage staff and point pools",
  resolveIdentity: "view and resolve identity",
  finalizeLeaderboard: "finalise leaderboard",
  requestGuests: "request walk-in guests",
  addGuests: "add walk-in guests",
  approveRequests: "approve guest requests",
};

const HIGH_RISK = new Set([
  "transferPoints",
  "reverseAwards",
  "reviewHeldActions",
  "manageStaffAndPools",
  "resolveIdentity",
  "finalizeLeaderboard",
]);

function presetState(preset: Preset): Record<string, boolean> {
  const enabled = new Set(PRESET_PERMISSIONS[preset]);
  return Object.fromEntries(PERMISSIONS.map((permission) => [permission, enabled.has(permission)]));
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function assignmentIsActive(assignment: AdminStaffAssignment) {
  if (assignment.status !== "active" || assignment.invitationState === "pending") return false;
  if (["revoked", "expired", "declined"].includes(assignment.invitationState ?? "")) return false;
  return !assignment.expiresAt || Date.parse(assignment.expiresAt) > Date.now();
}

function RoleSummary({
  role,
  activities,
  checkpoints,
}: {
  role: AdminStaffRole;
  activities: AdminScoringActivity[];
  checkpoints: Array<{ id: string; name: string }>;
}) {
  const parts: string[] = [];
  if (role.permissions.admitTickets) parts.push("entry check-in");
  if (role.permissions.scanCheckpoints) {
    const ids = stringIds(role.scope.checkpointIds);
    parts.push(
      ids.length
        ? ids.map((id) => checkpoints.find((entry) => entry.id === id)?.name ?? id).join(", ")
        : "all checkpoints",
    );
  }
  if (role.permissions.awardPoints || role.permissions.runActivities) {
    const ids = stringIds(role.scope.activityIds);
    parts.push(
      ids.length
        ? ids.map((id) => activities.find((entry) => entry.id === id)?.name ?? id).join(", ")
        : "all live activities",
    );
  }
  if (role.permissions.manageTeams) parts.push("teams");
  return <>{parts.length ? parts.join(" · ") : "no operational capabilities"}</>;
}

export function ScoringStaffPanel({
  eventSlug,
  activities,
  checkpoints,
  roles,
  staff,
  onAction,
  defaultPreset = "points-marshal",
}: {
  eventSlug: string;
  activities: AdminScoringActivity[];
  checkpoints: Array<{ id: string; name: string }>;
  roles: AdminStaffRole[];
  staff: AdminStaffAssignment[];
  onAction: ScoringAction;
  defaultPreset?: Preset;
}) {
  const [roleName, setRoleName] = useState("");
  const [preset, setPreset] = useState<Preset>(defaultPreset);
  const [permissions, setPermissions] = useState<Record<string, boolean>>(() =>
    presetState(defaultPreset),
  );
  const [activityIds, setActivityIds] = useState<string[]>([]);
  const [checkpointIds, setCheckpointIds] = useState<string[]>([]);
  const [roleReason, setRoleReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [openRoleId, setOpenRoleId] = useState<string>();
  const [recipientEmail, setRecipientEmail] = useState("");
  const [delivery, setDelivery] = useState<Delivery>("email");
  const [inviteReason, setInviteReason] = useState("");
  const [poolPoints, setPoolPoints] = useState(50);
  const [issuedUrl, setIssuedUrl] = useState("");
  const [issuedLabel, setIssuedLabel] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const { dataUrl: issuedQr, failed: issuedQrFailed } = useQrCode(issuedUrl || null, 320);

  const assignmentsByRole = useMemo(() => {
    const grouped = new Map<string, AdminStaffAssignment[]>();
    for (const assignment of staff) {
      grouped.set(assignment.roleId, [...(grouped.get(assignment.roleId) ?? []), assignment]);
    }
    return grouped;
  }, [staff]);

  async function createRole(event: React.FormEvent) {
    event.preventDefault();
    const risky = Object.entries(permissions).some(
      ([permission, enabled]) => enabled && HIGH_RISK.has(permission),
    );
    if (risky && !window.confirm("This role includes high-risk controls. Continue?")) return;
    const result = await onAction({
      action: "create-staff-role",
      label: roleName,
      preset,
      reason: roleReason,
      overrides: permissions,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      scope: { activityIds, checkpointIds, allowFreeformPoints: false, largeAwardWarningAt: 25 },
    });
    const role = result?.role as { id?: string } | undefined;
    if (!role?.id) return;
    setRoleName("");
    setRoleReason("");
    setOpenRoleId(role.id);
  }

  async function assignRole(role: AdminStaffRole) {
    const result = await onAction({
      action: "assign-staff-role",
      roleId: role.id,
      delivery,
      recipientEmail: delivery === "station" ? undefined : recipientEmail,
      reason: inviteReason,
    });
    const assignment = result?.assignment as
      | { id?: string; token?: string; actionUrl?: string }
      | undefined;
    if (!assignment?.id) return;
    if (poolPoints > 0 && role.permissions.awardPoints) {
      await onAction({
        action: "issue-pool",
        ownerType: delivery === "station" ? "station" : "staff",
        ownerId: assignment.id,
        points: poolPoints,
      });
    }
    const stationUrl = assignment.token
      ? `${window.location.origin}/events/${encodeURIComponent(eventSlug)}/staff/${assignment.token}`
      : "";
    setIssuedUrl(assignment.actionUrl ?? stationUrl);
    setIssuedLabel(
      delivery === "email"
        ? "Invitation emailed. It works once and is tied to that address."
        : delivery === "direct"
          ? "Role added to the existing verified identity."
          : delivery === "copy"
            ? "Copy this one-use invitation now. They must sign in with the invited email."
            : "Copy this reusable station link now. It is not tied to one person.",
    );
    setCopyMessage("");
    setRecipientEmail("");
    setInviteReason("");
  }

  return (
    <section aria-labelledby="staff-access-heading" className="border-t theme-border pt-6">
      <p className="font-mono text-micro uppercase tracking-widest theme-muted">
        people &amp; access
      </p>
      <h4 id="staff-access-heading" className="mt-2 font-serif text-2xl">
        Roles that match the night
      </h4>
      <p className="mt-2 max-w-xl font-mono text-xs leading-relaxed theme-muted">
        Define a role once, then add as many people as needed. One person can hold several roles;
        every action still has to fit one complete role and its scope.
      </p>

      <details className="mt-6 border-y theme-border py-4" open={roles.length === 0}>
        <summary className="flex min-h-11 cursor-pointer items-center font-mono text-xs">
          create a role
        </summary>
        <form
          onSubmit={(event) => void createRole(event)}
          className="mt-4 grid gap-4 sm:grid-cols-2"
        >
          <label className="font-mono text-xs">
            role name
            <input
              required
              value={roleName}
              onChange={(event) => setRoleName(event.target.value)}
              placeholder="e.g. food & points"
              className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
            />
          </label>
          <label className="font-mono text-xs">
            start from
            <AppSelect
              value={preset}
              onValueChange={(value) => {
                setPreset(value as Preset);
                setPermissions(presetState(value as Preset));
              }}
              options={PRESETS.map((value) => ({ value, label: value.replaceAll("-", " ") }))}
              variant="field"
              ariaLabel="Role starting preset"
              className="mt-2"
            />
          </label>
          <fieldset className="sm:col-span-2">
            <legend className="font-mono text-xs">what this role can do</legend>
            <div className="mt-2 grid gap-x-6 sm:grid-cols-2">
              {PERMISSIONS.map((permission) => (
                <label
                  key={permission}
                  className="flex min-h-11 items-center gap-2 font-mono text-xs"
                >
                  <input
                    type="checkbox"
                    checked={permissions[permission] === true}
                    onChange={(event) =>
                      setPermissions((current) => ({
                        ...current,
                        [permission]: event.target.checked,
                      }))
                    }
                  />
                  {LABELS[permission]}
                  {HIGH_RISK.has(permission) ? " · high risk" : ""}
                </label>
              ))}
            </div>
          </fieldset>

          {permissions.scanCheckpoints && (
            <fieldset className="sm:col-span-2 border-l-2 border-[var(--prose-hashtag)] pl-4">
              <legend className="font-mono text-xs">checkpoint access</legend>
              <p className="mt-1 font-mono text-micro theme-muted">
                Pick the named stations. Leave all unchecked only for every checkpoint.
              </p>
              <div className="mt-2 flex flex-wrap gap-x-5">
                {checkpoints.map((checkpoint) => (
                  <label
                    key={checkpoint.id}
                    className="flex min-h-11 items-center gap-2 font-mono text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={checkpointIds.includes(checkpoint.id)}
                      onChange={(event) =>
                        setCheckpointIds((current) =>
                          event.target.checked
                            ? [...current, checkpoint.id]
                            : current.filter((id) => id !== checkpoint.id),
                        )
                      }
                    />
                    {checkpoint.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {(permissions.awardPoints || permissions.runActivities) && (
            <fieldset className="sm:col-span-2">
              <legend className="font-mono text-xs">activity scope</legend>
              <p className="mt-1 font-mono text-micro theme-muted">
                Leave all unchecked for every live activity.
              </p>
              <div className="mt-2 flex flex-wrap gap-x-5">
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
          )}

          <label className="font-mono text-xs">
            audit reason
            <input
              required
              value={roleReason}
              onChange={(event) => setRoleReason(event.target.value)}
              placeholder="tomorrow’s event crew"
              className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
            />
          </label>
          <label className="font-mono text-xs">
            earlier expiry (optional)
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
            />
            <span className="mt-2 block font-mono text-micro theme-muted">
              Otherwise it ends with the event.
            </span>
          </label>
          <button className="min-h-11 border border-foreground px-4 font-mono text-xs sm:col-span-2 sm:w-fit">
            save role
          </button>
        </form>
      </details>

      <div className="mt-6 border-y theme-border">
        <div className="hidden grid-cols-[minmax(0,1fr)_auto_auto] gap-4 border-b theme-border px-3 py-2 font-mono text-micro uppercase tracking-widest theme-faint sm:grid">
          <span>role &amp; access</span>
          <span>status</span>
          <span className="w-16">control</span>
        </div>
        {roles.map((role) => {
          const assignments = assignmentsByRole.get(role.id) ?? [];
          const active = assignments.filter(assignmentIsActive);
          const pending = assignments.filter(
            (assignment) =>
              assignment.status === "active" && assignment.invitationState === "pending",
          );
          const isOpen = openRoleId === role.id;
          return (
            <article key={role.id} className="border-b theme-border last:border-b-0">
              <button
                type="button"
                onClick={() => setOpenRoleId(isOpen ? undefined : role.id)}
                aria-expanded={isOpen}
                className="grid w-full gap-3 px-3 py-4 text-left transition-opacity hover:opacity-70 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
              >
                <span className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-serif text-lg text-foreground">{role.label}</span>
                  </div>
                  <span className="mt-1 block font-mono text-micro leading-relaxed theme-muted">
                    <RoleSummary role={role} activities={activities} checkpoints={checkpoints} />
                  </span>
                  <span className="mt-1 block font-mono text-micro theme-faint">
                    ends {new Date(role.expiresAt).toLocaleString()}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <AdminStatus tone={role.status === "active" ? "positive" : "neutral"}>
                    {active.length} active
                  </AdminStatus>
                  {pending.length > 0 ? (
                    <AdminStatus tone="attention">{pending.length} pending</AdminStatus>
                  ) : null}
                </span>
                <span className="font-mono text-xs text-foreground sm:w-16 sm:text-right">
                  {isOpen ? "close ↑" : "manage ↓"}
                </span>
              </button>

              {isOpen && (
                <div className="border-t theme-border bg-[var(--stone-50)] px-3 py-4 dark:bg-white/[0.02]">
                  <StaffRoleAccess role={role} staff={assignments} onAction={onAction} />
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void assignRole(role);
                    }}
                    className="mt-5 grid gap-4 border-t theme-border pt-4 sm:grid-cols-2"
                  >
                    <p className="font-mono text-xs text-foreground sm:col-span-2">add someone</p>
                    <label className="font-mono text-xs">
                      how to add them
                      <AppSelect
                        value={delivery}
                        onValueChange={(value) => setDelivery(value as Delivery)}
                        options={[
                          { value: "email", label: "email one-use invite" },
                          { value: "copy", label: "copy one-use invite" },
                          { value: "direct", label: "assign verified identity" },
                          { value: "station", label: "shared station link" },
                        ]}
                        variant="field"
                        ariaLabel="Invitation method"
                        className="mt-2"
                      />
                    </label>
                    {delivery !== "station" ? (
                      <div>
                        <label className="font-mono text-xs">
                          email / identity
                          <input
                            required
                            type="email"
                            autoComplete="email"
                            value={recipientEmail}
                            onChange={(event) => setRecipientEmail(event.target.value)}
                            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
                          />
                        </label>
                        <EmailAddressNotice
                          email={recipientEmail}
                          onAcceptSuggestion={setRecipientEmail}
                        />
                      </div>
                    ) : (
                      <p className="font-mono text-xs leading-relaxed theme-muted">
                        Explicit exception: this reusable link is not tied to a person. Use it only
                        on a supervised device.
                      </p>
                    )}
                    <label className="font-mono text-xs">
                      audit reason
                      <input
                        required
                        value={inviteReason}
                        onChange={(event) => setInviteReason(event.target.value)}
                        className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
                      />
                    </label>
                    {role.permissions.awardPoints && (
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
                    )}
                    <button className="min-h-11 border border-foreground px-4 font-mono text-xs sm:col-span-2 sm:w-fit">
                      {delivery === "direct"
                        ? "assign role"
                        : delivery === "station"
                          ? "create station link"
                          : "create invitation"}
                    </button>
                  </form>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {issuedLabel && (
        <div className="mt-6 border-y theme-border py-4" role="status">
          <AdminStatus tone={issuedUrl ? "attention" : "positive"}>{issuedLabel}</AdminStatus>
          {issuedUrl && (
            <div className="mt-3">
              <input
                aria-label="New access link"
                readOnly
                value={issuedUrl}
                onFocus={(event) => event.currentTarget.select()}
                className="min-h-11 w-full border theme-border bg-transparent px-3 font-mono text-xs"
              />
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(issuedUrl)
                      .then(() => setCopyMessage("copied ✓"))
                      .catch(() => setCopyMessage("Copy failed — select the link above."))
                  }
                  className="min-h-11 border theme-border px-4 font-mono text-xs"
                >
                  {copyMessage || "copy link"}
                </button>
                {issuedQr && (
                  <a
                    href={issuedQr}
                    download={`${eventSlug}-staff-access.png`}
                    className="inline-flex min-h-11 items-center font-mono text-xs underline"
                  >
                    download QR
                  </a>
                )}
              </div>
              {issuedQr ? (
                <AppImage
                  src={issuedQr}
                  alt="QR code for new staff access"
                  width={320}
                  height={320}
                  className="mt-4 size-48 bg-white p-1"
                />
              ) : issuedQrFailed ? (
                <AdminStatus tone="danger" className="mt-3">
                  QR generation failed. Copy the link instead.
                </AdminStatus>
              ) : null}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
