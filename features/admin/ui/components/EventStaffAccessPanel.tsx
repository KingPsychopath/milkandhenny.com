import { useMemo, useState } from "react";

import { AppImage } from "@/components/AppImage";
import { AppSelect } from "@/components/AppSelect";
import { EmailAddressNotice } from "@/components/EmailAddressNotice";
import { useQrCode } from "@/hooks/useQrCode";
import type { AdminStaffAssignment, AdminStaffRole, StaffAccessAction } from "./staff-access-types";
import { AdminStatus } from "./AdminStatus";
import { StaffRoleAccess } from "./StaffAccessRegister";

const PRESETS = ["door-scanner", "checkpoint-scanner", "door-manager", "event-manager"] as const;
type Preset = (typeof PRESETS)[number];
type Delivery = "email" | "copy" | "direct" | "station";

const OPERATIONAL_PERMISSIONS = [
  "admitTickets",
  "scanCheckpoints",
  "manageTeams",
  "manageGuestPhotos",
  "requestGuests",
  "addGuests",
  "approveRequests",
] as const;

// Explicitly switch retired capabilities off when a role is created from a legacy preset.
const RETIRED_PERMISSIONS = [
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

const PRESET_PERMISSIONS: Record<Preset, readonly string[]> = {
  "door-scanner": ["admitTickets"],
  "checkpoint-scanner": ["scanCheckpoints"],
  "door-manager": ["admitTickets", "requestGuests", "addGuests", "approveRequests"],
  "event-manager": OPERATIONAL_PERMISSIONS,
};

const LABELS: Record<(typeof OPERATIONAL_PERMISSIONS)[number], string> = {
  admitTickets: "check guests in at entry",
  scanCheckpoints: "scan ticket allowances at checkpoints",
  manageTeams: "shuffle and move teams",
  manageGuestPhotos: "open and close the shared photo album",
  requestGuests: "request walk-in guests",
  addGuests: "add walk-in guests",
  approveRequests: "approve guest requests",
};

function presetState(preset: Preset): Record<string, boolean> {
  const enabled = new Set(PRESET_PERMISSIONS[preset]);
  return Object.fromEntries([
    ...OPERATIONAL_PERMISSIONS.map((permission) => [permission, enabled.has(permission)] as const),
    ...RETIRED_PERMISSIONS.map((permission) => [permission, false] as const),
  ]);
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
  checkpoints,
}: {
  role: AdminStaffRole;
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
  if (role.permissions.manageTeams) parts.push("teams");
  if (role.permissions.requestGuests) parts.push("guest requests");
  if (role.permissions.addGuests) parts.push("add guests");
  if (role.permissions.approveRequests) parts.push("approve guests");
  if (role.permissions.manageGuestPhotos) parts.push("guest photos");
  return <>{parts.length ? parts.join(" · ") : "no operational capabilities"}</>;
}

export function EventStaffAccessPanel({
  eventSlug,
  checkpoints,
  roles,
  staff,
  onAction,
  defaultPreset = "door-scanner",
}: {
  eventSlug: string;
  checkpoints: Array<{ id: string; name: string }>;
  roles: AdminStaffRole[];
  staff: AdminStaffAssignment[];
  onAction: StaffAccessAction;
  defaultPreset?: Preset;
}) {
  const [roleName, setRoleName] = useState("");
  const [preset, setPreset] = useState<Preset>(defaultPreset);
  const [permissions, setPermissions] = useState<Record<string, boolean>>(() =>
    presetState(defaultPreset),
  );
  const [checkpointIds, setCheckpointIds] = useState<string[]>([]);
  const [roleReason, setRoleReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [openRoleId, setOpenRoleId] = useState<string>();
  const [recipientEmail, setRecipientEmail] = useState("");
  const [delivery, setDelivery] = useState<Delivery>("email");
  const [inviteReason, setInviteReason] = useState("");
  const [issuedUrl, setIssuedUrl] = useState("");
  const [issuedLabel, setIssuedLabel] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [retireReason, setRetireReason] = useState("");
  const { dataUrl: issuedQr, failed: issuedQrFailed } = useQrCode(issuedUrl || null, 320);

  const activeRoles = roles.filter((role) => role.status === "active");
  const archivedRoles = roles.filter((role) => role.status === "archived");

  const assignmentsByRole = useMemo(() => {
    const grouped = new Map<string, AdminStaffAssignment[]>();
    for (const assignment of staff) {
      grouped.set(assignment.roleId, [...(grouped.get(assignment.roleId) ?? []), assignment]);
    }
    return grouped;
  }, [staff]);

  async function createRole(event: React.FormEvent) {
    event.preventDefault();
    const result = await onAction({
      action: "create-staff-role",
      label: roleName,
      preset,
      reason: roleReason,
      overrides: permissions,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      scope: { checkpointIds },
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
            ? "Copy this private one-use invitation now. Only the named email can accept it."
            : "Copy this reusable shared-device link now. It is not tied to a person or email.",
    );
    setCopyMessage("");
    setRecipientEmail("");
    setInviteReason("");
  }

  async function retireRole(role: AdminStaffRole) {
    const reason = retireReason.trim();
    if (!reason) return;
    if (
      !window.confirm(
        `Retire ${role.label}? This revokes every remaining link for this role and removes it from the active register.`,
      )
    )
      return;
    const result = await onAction({
      action: "archive-staff-role",
      roleId: role.id,
      reason,
    });
    if (!result?.archived) return;
    setRetireReason("");
    setOpenRoleId(undefined);
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
        Choose what a helper can do, then give that role to one or more people. Personal access is
        tied to email; a shared-device link is the quick, supervised fallback.
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
              placeholder="e.g. front door team"
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
              {OPERATIONAL_PERMISSIONS.map((permission) => (
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
        {activeRoles.map((role) => {
          const assignments = assignmentsByRole.get(role.id) ?? [];
          const active = assignments.filter(assignmentIsActive);
          const activePeople = active.filter(
            (assignment) => assignment.assignmentType === "personal",
          );
          const activeStations = active.filter(
            (assignment) => assignment.assignmentType === "station",
          );
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
                    <RoleSummary role={role} checkpoints={checkpoints} />
                  </span>
                  <span className="mt-1 block font-mono text-micro theme-faint">
                    ends {new Date(role.expiresAt).toLocaleString()}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {activePeople.length > 0 ? (
                    <AdminStatus tone="positive">
                      {activePeople.length} {activePeople.length === 1 ? "person" : "people"}
                    </AdminStatus>
                  ) : null}
                  {activeStations.length > 0 ? (
                    <AdminStatus tone="positive">
                      {activeStations.length} shared{" "}
                      {activeStations.length === 1 ? "link" : "links"}
                    </AdminStatus>
                  ) : null}
                  {pending.length > 0 ? (
                    <AdminStatus tone="attention">
                      {pending.length} pending {pending.length === 1 ? "invite" : "invites"}
                    </AdminStatus>
                  ) : null}
                  {active.length === 0 && pending.length === 0 ? (
                    <AdminStatus tone="neutral">no access</AdminStatus>
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
                          { value: "email", label: "email invite + create account" },
                          { value: "copy", label: "copy a private invite link" },
                          { value: "direct", label: "assign an existing account" },
                          { value: "station", label: "create a shared-device link" },
                        ]}
                        variant="field"
                        ariaLabel="Invitation method"
                        className="mt-2"
                      />
                    </label>
                    {delivery !== "station" ? (
                      <div>
                        <label className="font-mono text-xs">
                          {delivery === "direct" ? "verified account email" : "recipient email"}
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
                        <p className="mt-2 font-mono text-micro leading-relaxed theme-muted">
                          {delivery === "email"
                            ? "We send a one-use link. It verifies this email, creates their account if needed, signs them in and activates the role."
                            : delivery === "copy"
                              ? "The link works once and is reserved for this email. Send it privately."
                              : "Access is added immediately. This email must already belong to a verified account."}
                        </p>
                      </div>
                    ) : (
                      <p className="font-mono text-xs leading-relaxed theme-muted">
                        No email is needed. This reusable link can be opened by multiple helpers, so
                        use it only on supervised shared devices. You can disable it from this role.
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
                    <button className="min-h-11 border border-foreground px-4 font-mono text-xs sm:col-span-2 sm:w-fit">
                      {delivery === "direct"
                        ? "assign account"
                        : delivery === "station"
                          ? "create shared-device link"
                          : delivery === "copy"
                            ? "create private invite link"
                            : "send account invitation"}
                    </button>
                  </form>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void retireRole(role);
                    }}
                    className="mt-5 grid gap-3 border-t theme-border pt-4 sm:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <label className="font-mono text-xs">
                      retirement reason
                      <input
                        required
                        value={retireReason}
                        onChange={(event) => setRetireReason(event.target.value)}
                        placeholder="superseded after final crew setup"
                        className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
                      />
                    </label>
                    <button className="mh-action mh-action--danger self-end">retire role</button>
                    <p className="font-mono text-micro leading-relaxed theme-muted sm:col-span-2">
                      Retiring preserves the audit history while revoking every remaining person,
                      invite and shared-device link attached to this role.
                    </p>
                  </form>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {archivedRoles.length > 0 ? (
        <details className="mt-4 border-b theme-border pb-4">
          <summary className="flex min-h-11 cursor-pointer items-center font-mono text-xs theme-muted">
            archived roles ({archivedRoles.length})
          </summary>
          <ul className="mt-2 divide-y theme-border border-y theme-border">
            {archivedRoles.map((role) => (
              <li key={role.id} className="flex min-h-11 items-center justify-between gap-4 py-2">
                <span className="font-serif text-base">{role.label}</span>
                <AdminStatus tone="neutral">retired</AdminStatus>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

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
