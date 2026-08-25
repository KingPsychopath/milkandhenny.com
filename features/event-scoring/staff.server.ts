import { randomBytes } from "node:crypto";

import {
  actionEmailHash,
  issueActionLink,
  maskActionEmail,
  revokeActionLink,
} from "@/features/attendee-operations/action-links.server";
import { ensurePendingInvitedPerson } from "@/features/attendee-operations/invited-person.server";
import { emitDomainEvent } from "@/features/attendee-operations/notifications.server";
import { getAttendeeSession } from "@/features/event-scoring/session.server";
import { isValidEmail, normaliseEmail } from "@/features/tickets/types";
import { sendEmail } from "@/lib/platform/email.server";
import { query } from "@/lib/platform/postgres.server";
import { transaction } from "@/lib/platform/postgres.server";
import { buildAppUrl } from "@/lib/shared/app-url";
import { escapeEmailHtml, renderBrandedEmail } from "@/lib/shared/email-design";

import {
  createStaffAssignment,
  createStaffAssignmentInTransaction,
  createPool,
  adjustPool,
  recordStaffDevice,
  resolveStaffAssignment,
  resolvePersonalStaffAssignment,
  revokeStaffAssignment,
  revokeStaffDevice as revokeStoredStaffDevice,
  type StoredStaffAssignment,
} from "./store.server";
import {
  STAFF_PERMISSIONS,
  type StaffAssignmentType,
  type StaffPermission,
  type StaffPermissionSet,
} from "./types";

export const STAFF_PRESETS = {
  "door-scanner": ["admitTickets"] as const,
  "door-manager": ["admitTickets", "requestGuests", "addGuests", "approveRequests"] as const,
  "game-moderator": ["runActivities", "viewParticipantPoints", "awardPoints"] as const,
  "points-marshal": ["viewParticipantPoints", "awardPoints"] as const,
  "activity-manager": [
    "viewParticipantPoints",
    "awardPoints",
    "runActivities",
    "manageActivities",
  ] as const,
  "event-manager": [
    "admitTickets",
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
  invitedEmailHint?: string;
  emailQueued?: boolean;
};

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
      "This private link works once and attaches the role to this verified email.",
      "",
      "— milk & henny",
    ].join("\n"),
    html: renderBrandedEmail({
      origin: input.origin,
      label: "event staff access",
      title: "Your event role",
      contentHtml: `<p style="margin:0">You have been invited as <strong>${escapeEmailHtml(input.label)}</strong> for <strong>${escapeEmailHtml(input.eventSlug)}</strong>.</p>`,
      action: { label: "review staff access", url: actionUrl },
      note: `This private link expires ${escapeEmailHtml(input.expiresAt.toISOString())} and works once.`,
    }),
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
  if (!input.reason.trim()) throw new Error("A reason is required for staff access");
  const permissions = permissionsForPreset(input.preset, input.overrides);
  if (input.assignmentType === "station") {
    const token = `staff_${randomBytes(24).toString("base64url")}`;
    const assignment = await createStaffAssignment({
      eventSlug: input.eventSlug,
      label: input.label,
      assignmentType: "station",
      token,
      permissions,
      scope: { ...input.scope, rolePreset: input.preset },
      expiresAt: input.expiresAt,
      rolePreset: input.preset,
      invitationState: "active",
    });
    await query(
      `insert into score_audit_events
         (event_slug,action,actor_type,actor_id,entity_type,entity_id,metadata)
       values ($1,'staff.assignment.created','admin',$2,'staff_assignment',$3,$4::jsonb)`,
      [
        input.eventSlug,
        input.actorId,
        assignment.id,
        JSON.stringify({ assignmentType: "station", label: input.label, preset: input.preset }),
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
          rolePreset: input.preset,
        }),
        input.reason.trim(),
      ],
    );
    return { ...assignment, token };
  }

  if (!input.recipientEmail || !isValidEmail(input.recipientEmail))
    throw new Error("Personal staff access requires a valid recipient email");
  const appOrigin =
    input.origin?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    process.env.VITE_BASE_URL?.trim() ||
    "";
  if (!appOrigin) throw new Error("Application URL is not configured");
  const recipient = normaliseEmail(input.recipientEmail);
  const expiresAt = input.expiresAt
    ? new Date(input.expiresAt)
    : new Date(Date.now() + 72 * 60 * 60_000);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())
    throw new Error("Staff invitation expiry must be in the future");

  const created = await transaction(async (client) => {
    const invited = await ensurePendingInvitedPerson(client, {
      emailHash: actionEmailHash(recipient),
      emailHint: maskActionEmail(recipient),
      canonicalName: input.label,
    });
    const previous = await client.query<{
      id: string;
      invitation_link_id: string | null;
      invitation_state: string;
    }>(
      `select id,invitation_link_id,invitation_state from score_staff_assignments
        where event_slug = $1 and person_id = $2 and status = 'active'
          and invitation_state in ('pending','active') for update`,
      [input.eventSlug, invited.personId],
    );
    if (previous.rows.some((row) => row.invitation_state === "active"))
      throw new Error("That person already has active staff access for this event");
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
      issuedByType: "admin",
      issuedById: input.actorId,
      expiresAt,
    });
    const assignment = await createStaffAssignmentInTransaction(client, {
      eventSlug: input.eventSlug,
      label: input.label,
      assignmentType: "personal",
      personId: invited.personId,
      permissions,
      scope: { ...input.scope, rolePreset: input.preset },
      expiresAt: expiresAt.toISOString(),
      rolePreset: input.preset,
      invitationState: "pending",
      invitedEmailHash: actionEmailHash(recipient),
      invitationLinkId: link.id,
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
          rolePreset: input.preset,
        }),
        input.reason.trim(),
      ],
    );
    return { assignment, token: link.token };
  });

  const rendered = staffInvitationEmail({
    origin: appOrigin,
    eventSlug: input.eventSlug,
    label: input.label,
    recipient,
    token: created.token,
    expiresAt,
  });
  const delivery = await sendEmail(
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
  );
  if (!delivery.ok) {
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
    invitedEmailHint: maskActionEmail(recipient),
    emailQueued: delivery.ok,
  };
}

export async function resolveStaffAccess(input: {
  eventSlug: string;
  token: string;
  deviceId?: string;
}): Promise<StoredStaffAssignment | null> {
  const assignment =
    input.token === "personal"
      ? await (async () => {
          const session = await getAttendeeSession();
          return session?.personId
            ? resolvePersonalStaffAssignment(input.eventSlug, session.personId)
            : null;
        })()
      : await resolveStaffAssignment(input.eventSlug, input.token);
  if (assignment && input.deviceId && !(await recordStaffDevice(assignment.id, input.deviceId))) {
    return null;
  }
  return assignment;
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
