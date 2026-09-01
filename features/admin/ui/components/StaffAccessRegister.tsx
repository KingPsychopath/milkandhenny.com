import { useMemo } from "react";

import type { AdminStaffAssignment, AdminStaffRole, ScoringAction } from "./event-scoring-types";
import { AdminStatus, adminToneForStatus } from "./AdminStatus";

type AccessGroup = {
  key: string;
  name: string;
  email?: string;
  assignments: AdminStaffAssignment[];
};

function assignmentState(assignment: AdminStaffAssignment) {
  return assignment.invitationState ?? assignment.status;
}

function isCurrent(assignment: AdminStaffAssignment) {
  if (assignment.status !== "active") return false;
  if (["revoked", "expired", "declined"].includes(assignmentState(assignment))) return false;
  return !assignment.expiresAt || Date.parse(assignment.expiresAt) > Date.now();
}

function displayName(assignment: AdminStaffAssignment) {
  return (
    assignment.personName ||
    assignment.assignedEmailHint ||
    assignment.invitedEmailHint ||
    assignment.label
  );
}

function groupAssignments(assignments: AdminStaffAssignment[]): AccessGroup[] {
  const groups = new Map<string, AccessGroup>();
  for (const assignment of assignments) {
    const email = assignment.assignedEmailHint || assignment.invitedEmailHint;
    const key = assignment.personId
      ? `person:${assignment.personId}`
      : assignment.assignmentType === "personal" && email
        ? `invite:${email}`
        : `station:${assignment.id}`;
    const current = groups.get(key);
    if (current) {
      current.assignments.push(assignment);
      continue;
    }
    groups.set(key, {
      key,
      name: displayName(assignment),
      email,
      assignments: [assignment],
    });
  }
  return [...groups.values()];
}

function revokeLabel(assignment: AdminStaffAssignment) {
  if (assignment.invitationState === "pending") return "cancel invitation";
  if (assignment.assignmentType === "station") return "disable shared link";
  return "remove this person";
}

function deliveryLabel(assignment: AdminStaffAssignment) {
  if (assignment.invitationDelivery === "email") return "email invite";
  if (assignment.invitationDelivery === "copy") return "private invite link";
  if (assignment.invitationDelivery === "direct") return "verified account";
  return "shared-device link";
}

export function StaffRoleAccess({
  role,
  staff,
  onAction,
}: {
  role: AdminStaffRole;
  staff: AdminStaffAssignment[];
  onAction: ScoringAction;
}) {
  const assignments = staff.filter((assignment) => assignment.roleId === role.id);
  const current = assignments.filter(isCurrent);
  const history = assignments.filter((assignment) => !isCurrent(assignment));
  const groups = groupAssignments(current);
  const people = groups.filter((group) =>
    group.assignments.every((assignment) => assignment.assignmentType === "personal"),
  );
  const stations = groups.filter((group) =>
    group.assignments.some((assignment) => assignment.assignmentType === "station"),
  );
  const pendingPeople = people.filter((group) =>
    group.assignments.some((assignment) => assignment.invitationState === "pending"),
  );
  const activePeople = people.filter((group) => !pendingPeople.includes(group));
  const hasPendingInvitation = current.some(
    (assignment) => assignment.invitationState === "pending",
  );

  async function revoke(assignment: AdminStaffAssignment) {
    const action = revokeLabel(assignment);
    const reason = window.prompt(`Why are you choosing to ${action}?`)?.trim();
    if (!reason) return;
    await onAction({ action: "revoke-staff", assignmentId: assignment.id, reason });
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-xs text-foreground">current access</p>
          <p className="mt-1 max-w-xl font-mono text-micro leading-relaxed theme-muted">
            People have personal access tied to an email. A shared-device link is reusable and is
            not a person.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {activePeople.length > 0 ? (
            <AdminStatus tone="positive">
              {activePeople.length} {activePeople.length === 1 ? "person" : "people"}
            </AdminStatus>
          ) : null}
          {pendingPeople.length > 0 ? (
            <AdminStatus tone="attention">
              {pendingPeople.length} pending {pendingPeople.length === 1 ? "invite" : "invites"}
            </AdminStatus>
          ) : null}
          {stations.length > 0 ? (
            <AdminStatus tone="positive">
              {stations.length} shared {stations.length === 1 ? "link" : "links"}
            </AdminStatus>
          ) : null}
          {groups.length === 0 ? <AdminStatus tone="neutral">no access</AdminStatus> : null}
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="mt-3 font-mono text-micro theme-muted">No current access.</p>
      ) : (
        <ul className="mt-3 divide-y theme-border border-y theme-border">
          {groups.map((group) => {
            const isStation = group.assignments.some(
              (assignment) => assignment.assignmentType === "station",
            );
            const isPending = group.assignments.some(
              (assignment) => assignment.invitationState === "pending",
            );
            const activeDevices = group.assignments
              .flatMap((assignment) => assignment.devices)
              .filter((device) => !device.revokedAt).length;
            return (
              <li
                key={group.key}
                className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-mono text-xs text-foreground">
                      {isStation ? "shared-device link" : group.name}
                    </p>
                    <AdminStatus tone={isPending ? "attention" : "positive"}>
                      {isPending ? "awaiting acceptance" : "active"}
                    </AdminStatus>
                  </div>
                  {group.email && group.email !== group.name ? (
                    <p className="mt-1 truncate font-mono text-micro theme-muted">{group.email}</p>
                  ) : null}
                  <p className="mt-1 font-mono text-micro leading-relaxed theme-muted">
                    {isStation
                      ? `Reusable by multiple helpers · ${activeDevices} active ${activeDevices === 1 ? "device" : "devices"} · no person or email assigned`
                      : `${group.assignments.map(deliveryLabel).join(" · ")} · ${isPending ? "reserved for this email until accepted" : "personal access"}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 sm:justify-end">
                  {group.assignments.map((assignment) => (
                    <button
                      key={assignment.id}
                      type="button"
                      onClick={() => void revoke(assignment)}
                      className="min-h-11 font-mono text-micro underline underline-offset-4 hover:opacity-70"
                    >
                      {revokeLabel(assignment)}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hasPendingInvitation ? (
        <p className="mt-2 font-mono text-micro leading-relaxed theme-faint">
          Invite the same email again to replace a pending invitation; the older link is revoked
          automatically.
        </p>
      ) : null}

      {history.length > 0 ? (
        <details className="mt-3 border-t theme-border pt-2">
          <summary className="flex min-h-11 cursor-pointer items-center font-mono text-micro text-foreground">
            recent access history · {history.length}
          </summary>
          <p className="mb-2 font-mono text-micro leading-relaxed theme-muted">
            Expired and removed credentials stay in the event audit record but no longer work.
          </p>
          <ul className="divide-y theme-border">
            {history.slice(0, 20).map((assignment) => (
              <li key={assignment.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="font-mono text-micro text-foreground">
                  {displayName(assignment)} · {deliveryLabel(assignment)}
                </span>
                <AdminStatus tone={adminToneForStatus(assignmentState(assignment))}>
                  {assignmentState(assignment)}
                </AdminStatus>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function StaffAccessRegister({
  roles,
  staff,
  onAction,
}: {
  roles: AdminStaffRole[];
  staff: AdminStaffAssignment[];
  onAction: ScoringAction;
}) {
  const roleNames = useMemo(() => new Map(roles.map((role) => [role.id, role.label])), [roles]);
  const current = staff.filter(isCurrent);
  const history = staff.filter((assignment) => !isCurrent(assignment));
  const groups = groupAssignments(current);
  const pendingCount = current.filter(
    (assignment) => assignment.invitationState === "pending",
  ).length;

  async function revoke(assignment: AdminStaffAssignment) {
    const action = revokeLabel(assignment);
    const reason = window.prompt(`Why are you choosing to ${action}?`)?.trim();
    if (!reason) return;
    await onAction({ action: "revoke-staff", assignmentId: assignment.id, reason });
  }

  return (
    <section aria-labelledby="access-register-heading" className="mt-6 border-y theme-border py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-micro uppercase tracking-widest theme-muted">
            access register
          </p>
          <h5 id="access-register-heading" className="mt-1 font-serif text-xl">
            Who has access now
          </h5>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminStatus tone={groups.length > 0 ? "positive" : "neutral"}>
            {groups.length} {groups.length === 1 ? "person / station" : "people / stations"}
          </AdminStatus>
          {pendingCount > 0 && <AdminStatus tone="attention">{pendingCount} pending</AdminStatus>}
        </div>
      </div>
      <p className="mt-2 max-w-xl font-mono text-micro leading-relaxed theme-muted">
        Personal access is tied to identity. Pending invitations work once; accepted people can hold
        several roles. Shared stations are the visible exception.
      </p>
      {pendingCount > 0 && (
        <p className="mt-2 max-w-xl font-mono text-micro leading-relaxed theme-faint">
          To replace a pending invitation, open its role and invite that address again. The older
          link is revoked automatically.
        </p>
      )}

      {groups.length === 0 ? (
        <p className="mt-4 font-mono text-xs theme-muted">
          No current access or pending invitations.
        </p>
      ) : (
        <ul className="mt-4 divide-y theme-border border-t theme-border">
          {groups.map((group) => (
            <li key={group.key} className="py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-foreground">{group.name}</p>
                  {group.email && group.email !== group.name && (
                    <p className="mt-1 truncate font-mono text-micro theme-muted">{group.email}</p>
                  )}
                </div>
                {group.assignments.some(
                  (assignment) => assignment.invitationState === "pending",
                ) ? (
                  <AdminStatus tone="attention">invited</AdminStatus>
                ) : (
                  <AdminStatus tone="positive">active</AdminStatus>
                )}
              </div>

              <ul className="mt-3 divide-y theme-border border-y theme-border-faint">
                {group.assignments.map((assignment) => {
                  const state = assignmentState(assignment);
                  const roleName =
                    roleNames.get(assignment.roleId) ?? assignment.rolePreset ?? "role";
                  const activeDevices = assignment.devices.filter((device) => !device.revokedAt);
                  return (
                    <li
                      key={assignment.id}
                      className="grid gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-xs text-foreground">{roleName}</p>
                        <p className="mt-1 font-mono text-micro theme-muted">
                          {deliveryLabel(assignment)} ·{" "}
                          <AdminStatus tone={adminToneForStatus(state)}>{state}</AdminStatus>
                          {activeDevices.length > 0
                            ? ` · ${activeDevices.length} active device${activeDevices.length === 1 ? "" : "s"}`
                            : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void revoke(assignment)}
                        className="min-h-11 font-mono text-micro underline hover:opacity-70 sm:px-2"
                      >
                        {revokeLabel(assignment)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {history.length > 0 && (
        <details className="mt-4 border-t theme-border pt-3">
          <summary className="flex min-h-11 cursor-pointer items-center font-mono text-xs text-foreground">
            recent access history · {history.length}
          </summary>
          <p className="mb-2 font-mono text-micro leading-relaxed theme-muted">
            Revoked, declined, and expired access stays with the event audit record; credentials no
            longer work.
          </p>
          <ul className="divide-y theme-border">
            {history.slice(0, 20).map((assignment) => {
              const state = assignmentState(assignment);
              return (
                <li key={assignment.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span className="font-mono text-micro text-foreground">
                    {displayName(assignment)} ·{" "}
                    {roleNames.get(assignment.roleId) ?? assignment.rolePreset ?? "role"}
                  </span>
                  <AdminStatus tone={adminToneForStatus(state)}>{state}</AdminStatus>
                </li>
              );
            })}
          </ul>
          {history.length > 20 && (
            <p className="mt-2 font-mono text-micro theme-muted">
              Showing the 20 most recent of {history.length} records.
            </p>
          )}
        </details>
      )}
    </section>
  );
}
