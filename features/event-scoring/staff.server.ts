import { randomBytes } from "node:crypto";

import {
  actionEmailHash,
  issueActionLink,
  maskActionEmail,
  revokeActionLink,
} from "@/features/attendee-operations/action-links.server";
import { ensurePendingInvitedPerson } from "@/features/attendee-operations/invited-person.server";
import { requireIdentityMayAcquire } from "@/features/attendee-operations/identity-policy.server";
import { emitDomainEvent } from "@/features/attendee-operations/notifications.server";
import { getAttendeeSession } from "@/features/event-scoring/session.server";
import { getEvent } from "@/features/events/store.server";
import { isValidEmail, normaliseEmail } from "@/lib/shared/email-address";
import { sendEmail } from "@/lib/platform/email.server";
import { query, queryOne } from "@/lib/platform/postgres.server";
import { transaction } from "@/lib/platform/postgres.server";
import { buildAppUrl } from "@/lib/shared/app-url";
import { escapeEmailHtml, renderBrandedEmail } from "@/lib/shared/email-design";

import {
  createStaffAssignment,
  createStaffAssignmentInTransaction,
  createStaffRole,
  getStaffRole,
  createPool,
  adjustPool,
  recordStaffDevice,
  resolveStaffAssignment,
  resolvePersonalStaffAssignments,
  revokeStaffAssignment,
  revokeStaffDevice as revokeStoredStaffDevice,
  type StoredStaffAssignment,
  type StoredStaffRole,
} from "./store.server";
import {
  STAFF_PERMISSIONS,
  type StaffAssignmentType,
  type StaffPermission,
  type StaffPermissionSet,
} from "./types";

export const STAFF_PRESETS = {
  "door-scanner": ["admitTickets"] as const,
  "checkpoint-scanner": ["scanCheckpoints"] as const,
  "door-manager": ["admitTickets", "requestGuests", "addGuests", "approveRequests"] as const,
  "game-moderator": [
    "runActivities",
    "viewParticipantPoints",
    "awardPoints",
    "manageTeams",
  ] as const,
  "points-marshal": ["viewParticipantPoints", "awardPoints"] as const,
  "activity-manager": [
    "viewParticipantPoints",
    "awardPoints",
    "manageTeams",
    "runActivities",
    "manageActivities",
  ] as const,
  "event-manager": [
    "admitTickets",
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
    "manageGuestPhotos",
    "manageStaffAndPools",
    "resolveIdentity",
    "finalizeLeaderboard",
    "requestGuests",
    "addGuests",
    "approveRequests",
  ] as const,
  admin: STAFF_PERMISSIONS,
} as const satisfies Record<string, readonly StaffPermission[]>;

export type StaffPreset = keyof typeof STAFF_PRESETS;

export function permissionsForPreset(
  preset: StaffPreset,
  overrides?: Partial<StaffPermissionSet>,
): StaffPermissionSet {
  const presetPermissions: readonly string[] = STAFF_PRESETS[preset];
  const permissions = Object.fromEntries(
    STAFF_PERMISSIONS.map((permission) => [permission, presetPermissions.includes(permission)]),
  ) as StaffPermissionSet;
  for (const permission of STAFF_PERMISSIONS) {
    if (typeof overrides?.[permission] === "boolean")
      permissions[permission] = overrides[permission] as boolean;
  }
  return permissions;
}

export type StaffAccess = StoredStaffAssignment & {
  token?: string;
  actionUrl?: string;
  invitedEmailHint?: string;
  emailQueued?: boolean;
};

export type StaffInviteDelivery = "email" | "copy" | "direct" | "station";

async function validateRoleScope(eventSlug: string, scope: Record<string, unknown> = {}) {
  for (const key of ["activityIds", "checkpointIds"] as const) {
    const value = scope[key];
    if (
      value !== undefined &&
      (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    )
      throw new Error(`${key} must be a list of identifiers`);
  }
  const activityIds = (scope.activityIds as string[] | undefined) ?? [];
  const checkpointIds = (scope.checkpointIds as string[] | undefined) ?? [];
  if (activityIds.length > 0) {
    const rows = await query<{ id: string }>(
      `select id from score_activities where event_slug = $1 and id = any($2::text[])`,
      [eventSlug, activityIds],
    );
    if (new Set(rows.map((row) => row.id)).size !== new Set(activityIds).size)
      throw new Error("One or more scoped activities do not belong to this event");
  }
  if (checkpointIds.length > 0) {
    const rows = await query<{ id: string }>(
      `select id from checkpoints where event_slug = $1 and id = any($2::text[])`,
      [eventSlug, checkpointIds],
    );
    if (new Set(rows.map((row) => row.id)).size !== new Set(checkpointIds).size)
      throw new Error("One or more scoped checkpoints do not belong to this event");
  }
}

async function eventStaffExpiry(eventSlug: string, requested?: string): Promise<string> {
  const requestedExpiry = requested ? new Date(requested) : null;
  if (
    requestedExpiry &&
    (!Number.isFinite(requestedExpiry.getTime()) || requestedExpiry <= new Date())
  )
    throw new Error("Staff access expiry must be in the future");
  const event = await getEvent(eventSlug);
  if (!event) throw new Error("Event not found");
  const fallbackEnd = new Date(Date.parse(event.startsAt) + 12 * 60 * 60_000);
  const eventEnd = new Date(event.endsAt ?? fallbackEnd.toISOString());
  if (!Number.isFinite(eventEnd.getTime())) throw new Error("Event end time is invalid");
  const expiry = requestedExpiry ?? eventEnd;
  if (!Number.isFinite(expiry.getTime()) || expiry <= new Date())
    throw new Error("Staff access expiry must be in the future");
  if (expiry > eventEnd) throw new Error("Event staff access cannot continue beyond the event end");
  return expiry.toISOString();
}

export async function createEventStaffRole(input: {
  eventSlug: string;
  label: string;
  preset: StaffPreset;
  overrides?: Partial<StaffPermissionSet>;
  scope?: Record<string, unknown>;
  expiresAt?: string;
  actorId: string;
  reason: string;
}): Promise<StoredStaffRole> {
  if (!input.reason.trim()) throw new Error("A reason is required for a staff role");
  if (!input.label.trim()) throw new Error("A role name is required");
  await validateRoleScope(input.eventSlug, input.scope);
  const expiresAt = await eventStaffExpiry(input.eventSlug, input.expiresAt);
  const duplicate = await queryOne<{ id: string }>(
    `select id from event_staff_roles
      where event_slug = $1 and lower(label) = lower($2) and status = 'active'`,
    [input.eventSlug, input.label.trim()],
  );
  if (duplicate) throw new Error("A role with that name already exists for this event");
  const role = await createStaffRole({
    eventSlug: input.eventSlug,
    label: input.label,
    rolePreset: input.preset,
    permissions: permissionsForPreset(input.preset, input.overrides),
    scope: { ...input.scope, rolePreset: input.preset },
    expiresAt,
    createdBy: input.actorId,
  });
  await query(
    `insert into attendee_operations_audit_events
       (action,actor_type,actor_id,event_slug,entity_type,entity_id,before_state,after_state,reason)
     values ('staff.role.created','admin',$1,$2,'staff-role',$3,null,$4::jsonb,$5)`,
    [
      input.actorId,
      input.eventSlug,
      role.id,
      JSON.stringify({ label: role.label, rolePreset: role.rolePreset, expiresAt }),
      input.reason.trim(),
    ],
  );
  return role;
}

export async function updateEventStaffRoleScope(input: {
  eventSlug: string;
  roleId: string;
  scope: Record<string, unknown>;
  actorId: string;
  reason: string;
}): Promise<{ role: StoredStaffRole; updatedAssignments: number } | null> {
  if (!input.reason.trim()) throw new Error("A reason is required to update a staff role");
  await validateRoleScope(input.eventSlug, input.scope);
  const updatedAssignments = await transaction(async (client) => {
    const roleResult = await client.query<{
      label: string;
      role_preset: string;
      scope: Record<string, unknown>;
    }>(
      `select label,role_preset,scope from event_staff_roles
        where id = $1 and event_slug = $2 and status = 'active' and expires_at > now()
        for update`,
      [input.roleId, input.eventSlug],
    );
    const role = roleResult.rows[0];
    if (!role) return null;
    const before = role.scope ?? {};
    const scope = { ...before, ...input.scope, rolePreset: role.role_preset };
    await client.query(
      `update event_staff_roles set scope = $1::jsonb,updated_at = now() where id = $2`,
      [JSON.stringify(scope), input.roleId],
    );
    const assignments = await client.query(
      `update score_staff_assignments set scope = $1::jsonb
        where role_id = $2 and event_slug = $3 and status in ('active','paused')
        returning id`,
      [JSON.stringify(scope), input.roleId, input.eventSlug],
    );
    await client.query(
      `insert into score_audit_events
         (event_slug,action,actor_type,actor_id,entity_type,entity_id,metadata)
       values ($1,'staff.role.scope.updated','admin',$2,'staff_role',$3,$4::jsonb)`,
      [
        input.eventSlug,
        input.actorId,
        input.roleId,
        JSON.stringify({
          label: role.label,
          before,
          after: scope,
          updatedAssignments: assignments.rowCount ?? 0,
          reason: input.reason.trim(),
        }),
      ],
    );
    return assignments.rowCount ?? 0;
  });
  if (updatedAssignments === null) return null;
  const role = await getStaffRole(input.eventSlug, input.roleId);
  return role ? { role, updatedAssignments } : null;
}

export async function archiveEventStaffRole(input: {
  eventSlug: string;
  roleId: string;
  actorId: string;
  reason: string;
}): Promise<{ roleId: string; revokedAssignments: number } | null> {
  if (!input.reason.trim()) throw new Error("A reason is required to retire a staff role");
  return transaction(async (client) => {
    const roleResult = await client.query<{ id: string; label: string; status: string }>(
      `select id,label,status from event_staff_roles
        where id = $1 and event_slug = $2 and status = 'active'
        for update`,
      [input.roleId, input.eventSlug],
    );
    const role = roleResult.rows[0];
    if (!role) return null;

    const assignments = await client.query<{
      id: string;
      invitation_link_id: string | null;
    }>(
      `select id,invitation_link_id from score_staff_assignments
        where role_id = $1 and event_slug = $2
          and status in ('active','paused')
        for update`,
      [input.roleId, input.eventSlug],
    );
    const assignmentIds = assignments.rows.map((assignment) => assignment.id);
    if (assignmentIds.length > 0) {
      await client.query(
        `update score_staff_assignments
            set status = 'revoked',
                invitation_state = case
                  when assignment_type = 'personal' then 'revoked'
                  else invitation_state
                end,
                revoked_at = now()
          where id = any($1::text[])`,
        [assignmentIds],
      );
      await client.query(
        `update score_staff_devices set revoked_at = now()
          where assignment_id = any($1::text[]) and revoked_at is null`,
        [assignmentIds],
      );
    }
    for (const assignment of assignments.rows) {
      if (assignment.invitation_link_id) {
        await revokeActionLink(client, assignment.invitation_link_id, "staff-role-retired");
      }
    }

    await client.query(
      `update event_staff_roles set status = 'archived',updated_at = now() where id = $1`,
      [input.roleId],
    );
    const after = { status: "archived", revokedAssignments: assignmentIds.length };
    await client.query(
      `insert into score_audit_events
         (event_slug,action,actor_type,actor_id,entity_type,entity_id,metadata)
       values ($1,'staff.role.archived','admin',$2,'staff_role',$3,$4::jsonb)`,
      [
        input.eventSlug,
        input.actorId,
        input.roleId,
        JSON.stringify({ label: role.label, ...after, reason: input.reason.trim() }),
      ],
    );
    await client.query(
      `insert into attendee_operations_audit_events
         (action,actor_type,actor_id,event_slug,entity_type,entity_id,before_state,after_state,reason)
       values ('staff.role.archived','admin',$1,$2,'staff-role',$3,$4::jsonb,$5::jsonb,$6)`,
      [
        input.actorId,
        input.eventSlug,
        input.roleId,
        JSON.stringify({ label: role.label, status: role.status }),
        JSON.stringify(after),
        input.reason.trim(),
      ],
    );
    return { roleId: input.roleId, revokedAssignments: assignmentIds.length };
  });
}

function staffInvitationEmail(input: {
  origin: string;
  eventSlug: string;
  label: string;
  recipient: string;
  token: string;
  expiresAt: Date;
}) {
  const actionUrl = buildAppUrl(input.origin, `/action/${input.token}`);
  return {
    actionUrl,
    text: [
      "Event staff access",
      "",
      `Event: ${input.eventSlug}`,
      `Role: ${input.label}`,
      `Accept: ${actionUrl}`,
      `Expires: ${input.expiresAt.toISOString()}`,
      "",
      "This private link works once. It verifies this email, creates a Milk & Henny account if needed, signs the recipient in, and attaches the role.",
      "",
      "— milk & henny",
    ].join("\n"),
    html: renderBrandedEmail({
      origin: input.origin,
      label: "event staff access",
      title: "Your event role",
      contentHtml: `<p style="margin:0">You have been invited as <strong>${escapeEmailHtml(input.label)}</strong> for <strong>${escapeEmailHtml(input.eventSlug)}</strong>.</p>`,
      action: { label: "review staff access", url: actionUrl },
      note: `This private link expires ${escapeEmailHtml(input.expiresAt.toISOString())} and works once. It creates your account if you do not already have one.`,
    }),
  };
}

export async function assignEventStaffRole(input: {
  eventSlug: string;
  roleId: string;
  delivery: StaffInviteDelivery;
  actorId: string;
  reason: string;
  recipientEmail?: string;
  origin?: string;
}): Promise<StaffAccess> {
  if (!input.reason.trim()) throw new Error("A reason is required for staff access");
  const role = await getStaffRole(input.eventSlug, input.roleId);
  if (!role) throw new Error("That staff role is unavailable or expired");

  if (input.delivery === "station") {
    const token = `staff_${randomBytes(24).toString("base64url")}`;
    const assignment = await createStaffAssignment({
      eventSlug: input.eventSlug,
      label: role.label,
      assignmentType: "station",
      token,
      permissions: role.permissions,
      scope: role.scope,
      expiresAt: role.expiresAt,
      rolePreset: role.rolePreset,
      invitationState: "active",
      roleId: role.id,
      invitationDelivery: "station",
    });
    await query(
      `insert into score_audit_events
         (event_slug,action,actor_type,actor_id,entity_type,entity_id,metadata)
       values ($1,'staff.assignment.created','admin',$2,'staff_assignment',$3,$4::jsonb)`,
      [
        input.eventSlug,
        input.actorId,
        assignment.id,
        JSON.stringify({ assignmentType: "station", label: role.label, roleId: role.id }),
      ],
    );
    await query(
      `insert into attendee_operations_audit_events
         (action,actor_type,actor_id,event_slug,entity_type,entity_id,before_state,after_state,reason)
       values ('staff.station.created','admin',$1,$2,'staff-assignment',$3,null,$4::jsonb,$5)`,
      [
        input.actorId,
        input.eventSlug,
        assignment.id,
        JSON.stringify({
          status: "active",
          assignmentType: "station",
          rolePreset: role.rolePreset,
          roleId: role.id,
        }),
        input.reason.trim(),
      ],
    );
    return { ...assignment, token };
  }

  if (!input.recipientEmail || !isValidEmail(input.recipientEmail))
    throw new Error("Personal staff access requires a valid recipient email");
  const recipient = normaliseEmail(input.recipientEmail);
  await requireIdentityMayAcquire(
    recipient,
    "This identity cannot receive new staff permissions. Existing access is unchanged.",
  );
  const recipientHash = actionEmailHash(recipient);
  const recipientHint = maskActionEmail(recipient);

  if (input.delivery === "direct") {
    const identity = await queryOne<{ person_id: string }>(
      `select person_id from event_person_identifiers
        where kind = 'email' and value_hash = $1 and verified_at is not null`,
      [recipientHash],
    );
    if (!identity) throw new Error("Direct assignment requires an existing verified identity");
    const existing = await queryOne<{ id: string }>(
      `select id from score_staff_assignments
        where role_id = $1 and person_id = $2 and status in ('active','paused')
          and invitation_state in ('pending','active')`,
      [role.id, identity.person_id],
    );
    if (existing) throw new Error("That person already has this role");
    const assignment = await createStaffAssignment({
      eventSlug: input.eventSlug,
      label: role.label,
      assignmentType: "personal",
      personId: identity.person_id,
      permissions: role.permissions,
      scope: role.scope,
      expiresAt: role.expiresAt,
      rolePreset: role.rolePreset,
      invitationState: "active",
      invitedEmailHash: recipientHash,
      roleId: role.id,
      invitedEmailHint: recipientHint,
      invitationDelivery: "direct",
    });
    await query(
      `insert into attendee_operations_audit_events
         (action,actor_type,actor_id,event_slug,entity_type,entity_id,before_state,after_state,reason)
       values ('staff.assignment.direct','admin',$1,$2,'staff-assignment',$3,null,$4::jsonb,$5)`,
      [
        input.actorId,
        input.eventSlug,
        assignment.id,
        JSON.stringify({ roleId: role.id, personId: identity.person_id }),
        input.reason.trim(),
      ],
    );
    return { ...assignment, invitedEmailHint: recipientHint };
  }

  if (input.delivery !== "email" && input.delivery !== "copy")
    throw new Error("Choose email, copy link, direct identity, or shared station access");
  const appOrigin =
    input.origin?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    process.env.VITE_BASE_URL?.trim() ||
    "";
  if (!appOrigin) throw new Error("Application URL is not configured");
  const expiresAt = new Date(role.expiresAt);

  const created = await transaction(async (client) => {
    const invited = await ensurePendingInvitedPerson(client, {
      emailHash: recipientHash,
      emailHint: recipientHint,
      emailAddress: recipient,
      canonicalName: role.label,
    });
    const previous = await client.query<{
      id: string;
      invitation_link_id: string | null;
      invitation_state: string;
    }>(
      `select id,invitation_link_id,invitation_state from score_staff_assignments
        where role_id = $1 and person_id = $2 and status = 'active'
          and invitation_state in ('pending','active') for update`,
      [role.id, invited.personId],
    );
    if (previous.rows.some((row) => row.invitation_state === "active"))
      throw new Error("That person already has this role");
    for (const row of previous.rows) {
      await client.query(
        `update score_staff_assignments
            set status = 'revoked',invitation_state = 'revoked',revoked_at = now()
          where id = $1`,
        [row.id],
      );
      if (row.invitation_link_id)
        await revokeActionLink(client, row.invitation_link_id, "replaced-by-new-invitation");
    }
    const temporaryId = `staff_${randomBytes(18).toString("hex").slice(0, 24)}`;
    const link = await issueActionLink(client, {
      purpose: "staff-invitation",
      intendedEmail: recipient,
      entityType: "staff-assignment",
      entityId: temporaryId,
      payload: { delivery: input.delivery, roleId: role.id },
      issuedByType: "admin",
      issuedById: input.actorId,
      expiresAt,
    });
    const assignment = await createStaffAssignmentInTransaction(client, {
      eventSlug: input.eventSlug,
      label: role.label,
      assignmentType: "personal",
      personId: invited.personId,
      permissions: role.permissions,
      scope: role.scope,
      expiresAt: expiresAt.toISOString(),
      rolePreset: role.rolePreset,
      invitationState: "pending",
      invitedEmailHash: recipientHash,
      invitationLinkId: link.id,
      roleId: role.id,
      invitedEmailHint: recipientHint,
      invitationDelivery: input.delivery,
    });
    await client.query(`update attendee_action_links set entity_id = $2 where id = $1`, [
      link.id,
      assignment.id,
    ]);
    await client.query(
      `insert into attendee_operations_audit_events
         (action,actor_type,actor_id,event_slug,entity_type,entity_id,before_state,after_state,reason)
       values ('staff.invitation.issued','admin',$1,$2,'staff-assignment',$3,null,$4::jsonb,$5)`,
      [
        input.actorId,
        input.eventSlug,
        assignment.id,
        JSON.stringify({
          invitationState: "pending",
          personId: invited.personId,
          rolePreset: role.rolePreset,
          roleId: role.id,
          delivery: input.delivery,
        }),
        input.reason.trim(),
      ],
    );
    return { assignment, token: link.token };
  });

  const rendered = staffInvitationEmail({
    origin: appOrigin,
    eventSlug: input.eventSlug,
    label: role.label,
    recipient,
    token: created.token,
    expiresAt,
  });
  const delivery =
    input.delivery === "email"
      ? await sendEmail(
          {
            channel: "access",
            to: recipient,
            subject: `Event staff access — ${input.eventSlug}`,
            text: rendered.text,
            html: rendered.html,
          },
          {
            idempotencyKey: `staff-access:${created.assignment.id}`,
            kind: "staff-access",
            source: "admin",
            context: { eventSlug: input.eventSlug, staffAssignmentId: created.assignment.id },
          },
        )
      : null;
  if (delivery && !delivery.ok) {
    await emitDomainEvent({
      kind: "staff.invitation_email_failed",
      deduplicationKey: `staff-assignment:${created.assignment.id}:email-failed`,
      actorType: "system",
      eventSlug: input.eventSlug,
      entityRefs: { staffAssignmentId: created.assignment.id },
      severity: "warning",
      admin: {
        title: "Staff invitation email failed",
        body: "The invitation remains pending. Review delivery before replacing it.",
        deepLink: `/admin?view=events&event=${encodeURIComponent(input.eventSlug)}`,
        category: "access-email-failed",
        createCase: true,
      },
    });
  }
  return {
    ...created.assignment,
    token: input.delivery === "copy" ? created.token : undefined,
    actionUrl: input.delivery === "copy" ? rendered.actionUrl : undefined,
    invitedEmailHint: recipientHint,
    emailQueued: delivery?.ok,
  };
}

export async function createStaffAccess(input: {
  eventSlug: string;
  label: string;
  assignmentType: StaffAssignmentType;
  preset: StaffPreset;
  overrides?: Partial<StaffPermissionSet>;
  scope?: Record<string, unknown>;
  expiresAt?: string;
  actorId: string;
  reason: string;
  recipientEmail?: string;
  origin?: string;
}): Promise<StaffAccess> {
  const role = await createEventStaffRole(input);
  return assignEventStaffRole({
    eventSlug: input.eventSlug,
    roleId: role.id,
    delivery: input.assignmentType === "station" ? "station" : "email",
    actorId: input.actorId,
    reason: input.reason,
    recipientEmail: input.recipientEmail,
    origin: input.origin,
  });
}

export type ResolvedStaffAccess = StoredStaffAssignment & {
  assignments: StoredStaffAssignment[];
};

export async function resolveStaffAccess(input: {
  eventSlug: string;
  token: string;
  deviceId?: string;
}): Promise<ResolvedStaffAccess | null> {
  const assignments =
    input.token === "personal"
      ? await (async () => {
          const session = await getAttendeeSession();
          return session?.personId
            ? resolvePersonalStaffAssignments(input.eventSlug, session.personId)
            : [];
        })()
      : await (async () => {
          const assignment = await resolveStaffAssignment(input.eventSlug, input.token);
          return assignment ? [assignment] : [];
        })();
  if (assignments.length === 0) return null;
  if (input.deviceId) {
    const deviceId = input.deviceId;
    const active = (
      await Promise.all(
        assignments.map(async (assignment) =>
          (await recordStaffDevice(assignment.id, deviceId)) ? assignment : null,
        ),
      )
    ).filter((assignment): assignment is StoredStaffAssignment => assignment !== null);
    return active[0] ? { ...active[0], assignments: active } : null;
  }
  return { ...assignments[0]!, assignments };
}

/**
 * Choose one complete grant for an action. Never merge a permission from one
 * role with the scope from another: that would turn two narrow roles into an
 * unintended broad role.
 */
export function staffAssignmentForPermission(
  access: ResolvedStaffAccess | null,
  permission: StaffPermission,
  accepts: (assignment: StoredStaffAssignment) => boolean = () => true,
): StoredStaffAssignment | null {
  return (
    access?.assignments.find(
      (assignment) => hasStaffPermission(assignment, permission) && accepts(assignment),
    ) ?? null
  );
}

export function hasStaffPermission(
  assignment: Pick<StoredStaffAssignment, "permissions">,
  permission: StaffPermission,
): boolean {
  return assignment.permissions[permission] === true;
}

export function requireStaffPermission(
  assignment: Pick<StoredStaffAssignment, "permissions"> | null,
  permission: StaffPermission,
): { ok: true } | { ok: false; status: 403; error: string } {
  return assignment && hasStaffPermission(assignment, permission)
    ? { ok: true }
    : { ok: false, status: 403, error: "This staff link cannot perform that action" };
}

export async function issueStaffPool(input: {
  eventSlug: string;
  ownerType: "staff" | "station" | "activity" | "event";
  ownerId?: string;
  activityId?: string;
  points: number;
  actorId: string;
}) {
  const result = await createPool(input);
  if (!result.ok) return result;
  await query(
    `insert into score_audit_events
       (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
     values ($1,'pool.created','admin',$2,'score_pool',$3,$4::jsonb)`,
    [
      input.eventSlug,
      input.actorId,
      result.value.id,
      JSON.stringify({ ownerType: input.ownerType, ownerId: input.ownerId, points: input.points }),
    ],
  );
  return result;
}

export async function adjustStaffPool(input: {
  eventSlug: string;
  poolId: string;
  delta: number;
  actorId: string;
}) {
  const result = await adjustPool(input.poolId, input.delta, input.eventSlug);
  if (!result.ok) return result;
  await query(
    `insert into score_audit_events
       (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
     values ($1,'pool.adjusted','admin',$2,'score_pool',$3,$4::jsonb)`,
    [input.eventSlug, input.actorId, input.poolId, JSON.stringify({ delta: input.delta })],
  );
  return result;
}

export async function revokeStaffAccess(input: {
  eventSlug: string;
  assignmentId: string;
  actorId: string;
  reason: string;
}): Promise<boolean> {
  if (!input.reason.trim()) throw new Error("A staff revocation reason is required");
  const before = await query<{
    status: string;
    invitation_state: string;
    invitation_link_id: string | null;
  }>(
    `select status,invitation_state,invitation_link_id from score_staff_assignments
      where id = $1 and event_slug = $2`,
    [input.assignmentId, input.eventSlug],
  );
  const revoked = await revokeStaffAssignment(input.eventSlug, input.assignmentId);
  if (!revoked) return false;
  const linkId = before[0]?.invitation_link_id;
  if (linkId) {
    await transaction((client) => revokeActionLink(client, linkId, "staff-access-revoked"));
  }
  await query(
    `insert into score_audit_events
       (event_slug,action,actor_type,actor_id,entity_type,entity_id,metadata)
     values ($1,'staff.assignment.revoked','admin',$2,'staff_assignment',$3,$4::jsonb)`,
    [
      input.eventSlug,
      input.actorId,
      input.assignmentId,
      JSON.stringify({
        before: before[0] ?? null,
        after: { status: "revoked" },
        reason: input.reason.trim(),
      }),
    ],
  );
  await query(
    `insert into attendee_operations_audit_events
       (action,actor_type,actor_id,event_slug,entity_type,entity_id,before_state,after_state,reason)
     values ('staff.access.revoked','admin',$1,$2,'staff-assignment',$3,$4::jsonb,
             '{"status":"revoked","invitationState":"revoked"}'::jsonb,$5)`,
    [
      input.actorId,
      input.eventSlug,
      input.assignmentId,
      JSON.stringify(before[0] ?? null),
      input.reason.trim(),
    ],
  );
  return true;
}

export async function revokeStaffAccessDevice(input: {
  eventSlug: string;
  assignmentId: string;
  deviceId: string;
  actorId: string;
  reason: string;
}): Promise<boolean> {
  if (!input.reason.trim()) throw new Error("A device revocation reason is required");
  const revoked = await revokeStoredStaffDevice(input);
  if (!revoked) return false;
  await query(
    `insert into score_audit_events
       (event_slug, action, actor_type, actor_id, assignment_id, device_id, entity_type, entity_id,metadata)
     values ($1,'staff.device.revoked','admin',$2,$3,$4,'staff_device',$4,$5::jsonb)`,
    [
      input.eventSlug,
      input.actorId,
      input.assignmentId,
      input.deviceId,
      JSON.stringify({ reason: input.reason.trim() }),
    ],
  );
  await query(
    `insert into attendee_operations_audit_events
       (action,actor_type,actor_id,event_slug,entity_type,entity_id,before_state,after_state,reason)
     values ('staff.device.revoked','admin',$1,$2,'staff-device',$3,
             '{"status":"active"}'::jsonb,'{"status":"revoked"}'::jsonb,$4)`,
    [input.actorId, input.eventSlug, input.deviceId, input.reason.trim()],
  );
  return true;
}
