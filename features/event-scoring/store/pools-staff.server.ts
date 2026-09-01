import type { PoolClient } from "pg";

import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import type { StaffAssignmentStatus, StaffAssignmentType, StaffPermissionSet } from "../types";
import {
  hashStaffToken,
  id,
  iso,
  recordObject,
  type ScoreStoreResult,
  type StaffAssignmentRow,
  type StaffRoleRow,
  type StoredStaffAssignment,
  type StoredStaffDevice,
  type StoredStaffRole,
} from "./common.server";

export async function createStaffRole(input: {
  eventSlug: string;
  label: string;
  rolePreset: string;
  permissions: StaffPermissionSet;
  scope?: Record<string, unknown>;
  expiresAt: string;
  createdBy: string;
}): Promise<StoredStaffRole> {
  const row = await queryOne<StaffRoleRow>(
    `insert into event_staff_roles
       (id,event_slug,label,role_preset,permissions,scope,expires_at,created_by)
     values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)
     returning *`,
    [
      id("role"),
      input.eventSlug,
      input.label.trim(),
      input.rolePreset,
      JSON.stringify(input.permissions),
      JSON.stringify(input.scope ?? {}),
      input.expiresAt,
      input.createdBy,
    ],
  );
  if (!row) throw new Error("Staff role could not be created");
  return toStaffRole(row);
}

export async function getStaffRole(
  eventSlug: string,
  roleId: string,
): Promise<StoredStaffRole | null> {
  const row = await queryOne<StaffRoleRow>(
    `select * from event_staff_roles
      where id = $1 and event_slug = $2 and status = 'active' and expires_at > now()`,
    [roleId, eventSlug],
  );
  return row ? toStaffRole(row) : null;
}

export async function listStaffRoles(eventSlug: string): Promise<StoredStaffRole[]> {
  const rows = await query<StaffRoleRow>(
    `select * from event_staff_roles where event_slug = $1 order by created_at desc, id`,
    [eventSlug],
  );
  return rows.map(toStaffRole);
}

function toStaffRole(row: StaffRoleRow): StoredStaffRole {
  return {
    id: row.id,
    eventSlug: row.event_slug,
    label: row.label,
    rolePreset: row.role_preset,
    permissions: recordObject(row.permissions) as unknown as StaffPermissionSet,
    scope: recordObject(row.scope),
    expiresAt: row.expires_at.toISOString(),
    status: row.status === "archived" ? "archived" : "active",
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function createPool(input: {
  eventSlug: string;
  activityId?: string;
  ownerType: "event" | "staff" | "station" | "activity";
  ownerId?: string;
  points: number;
}): Promise<ScoreStoreResult<{ id: string; available: number }>> {
  const points = Math.trunc(input.points);
  if (!Number.isInteger(points) || points < 0)
    return { ok: false, status: 400, error: "Pool points must be zero or more" };
  const row = await queryOne<{ id: string; issued_points: number }>(
    `insert into score_pools (id, event_slug, activity_id, owner_type, owner_id, issued_points)
     values ($1,$2,$3,$4,$5,$6)
     returning id, issued_points`,
    [
      id("pool"),
      input.eventSlug,
      input.activityId ?? null,
      input.ownerType,
      input.ownerId ?? null,
      points,
    ],
  );
  if (!row) return { ok: false, status: 500, error: "Point pool could not be created" };
  return { ok: true, value: { id: row.id, available: row.issued_points } };
}

export async function adjustPool(
  poolId: string,
  delta: number,
  eventSlug: string,
): Promise<ScoreStoreResult<{ issued: number; available: number }>> {
  const amount = Math.trunc(delta);
  if (!Number.isInteger(amount) || amount === 0)
    return { ok: false, status: 400, error: "Pool adjustment must be a non-zero whole number" };
  const row = await queryOne<{
    issued_points: number;
    reserved_points: number;
    spent_points: number;
    held_points: number;
  }>(
    `update score_pools
        set issued_points = issued_points + $2, updated_at = now()
      where id = $1
        and event_slug = $3
        and issued_points + $2 >= reserved_points + spent_points + held_points
      returning issued_points, reserved_points, spent_points, held_points`,
    [poolId, amount, eventSlug],
  );
  if (!row)
    return {
      ok: false,
      status: 409,
      error: "The pool adjustment would make issued points unavailable",
    };
  return {
    ok: true,
    value: {
      issued: row.issued_points,
      available: row.issued_points - row.reserved_points - row.spent_points - row.held_points,
    },
  };
}

export async function listPools(eventSlug: string): Promise<
  {
    id: string;
    activityId?: string;
    ownerType: string;
    ownerId?: string;
    issued: number;
    reserved: number;
    spent: number;
    held: number;
    available: number;
  }[]
> {
  const rows = await query<{
    id: string;
    activity_id: string | null;
    owner_type: string;
    owner_id: string | null;
    issued_points: number;
    reserved_points: number;
    spent_points: number;
    held_points: number;
  }>(`select * from score_pools where event_slug = $1 order by created_at, id`, [eventSlug]);
  return rows.map((row) => ({
    id: row.id,
    activityId: row.activity_id ?? undefined,
    ownerType: row.owner_type,
    ownerId: row.owner_id ?? undefined,
    issued: row.issued_points,
    reserved: row.reserved_points,
    spent: row.spent_points,
    held: row.held_points,
    available: row.issued_points - row.reserved_points - row.spent_points - row.held_points,
  }));
}

export async function releaseActivityReservations(
  eventSlug: string,
  activityId: string,
): Promise<number> {
  return transaction(async (client) => {
    const released = await client.query<{ pool_id: string; points: number }>(
      `with closed as (
         update score_offline_reservations
            set status = 'closed', closed_at = now()
          where event_slug = $1 and activity_id = $2 and status = 'active'
         returning pool_id, issued_points - spent_points as points
       )
       select pool_id, sum(points)::integer as points from closed group by pool_id`,
      [eventSlug, activityId],
    );
    let total = 0;
    for (const row of released.rows) {
      await client.query(
        `update score_pools
            set reserved_points = reserved_points - $2, updated_at = now()
          where id = $1 and reserved_points >= $2`,
        [row.pool_id, row.points],
      );
      total += row.points;
    }
    return total;
  });
}

export async function createStaffAssignment(input: {
  eventSlug: string;
  label: string;
  assignmentType: StaffAssignmentType;
  personId?: string;
  token?: string;
  permissions: StaffPermissionSet;
  scope?: Record<string, unknown>;
  expiresAt?: string;
  rolePreset?: string;
  invitationState?: "pending" | "active";
  invitedEmailHash?: string;
  invitationLinkId?: string;
  roleId: string;
  invitedEmailHint?: string;
  invitationDelivery?: "email" | "copy" | "direct" | "station";
}): Promise<StoredStaffAssignment> {
  return transaction((client) => createStaffAssignmentInTransaction(client, input));
}

export async function createStaffAssignmentInTransaction(
  client: PoolClient,
  input: {
    eventSlug: string;
    label: string;
    assignmentType: StaffAssignmentType;
    personId?: string;
    token?: string;
    permissions: StaffPermissionSet;
    scope?: Record<string, unknown>;
    expiresAt?: string;
    rolePreset?: string;
    invitationState?: "pending" | "active";
    invitedEmailHash?: string;
    invitationLinkId?: string;
    roleId: string;
    invitedEmailHint?: string;
    invitationDelivery?: "email" | "copy" | "direct" | "station";
  },
): Promise<StoredStaffAssignment> {
  if (input.assignmentType === "personal" && !input.personId)
    throw new Error("Personal staff access requires a person identity");
  if (input.assignmentType === "station" && !input.token)
    throw new Error("Station staff access requires a bearer credential");
  const result = await client.query<StaffAssignmentRow>(
    `insert into score_staff_assignments
         (id,event_slug,person_id,label,assignment_type,token_hash,permissions,scope,expires_at,
          role_preset,invitation_state,invited_email_hash,invitation_link_id,activated_at,
          role_id,invited_email_hint,invitation_delivery)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,
               case when $11 = 'active' then now() else null end,$14,$15,$16)
       returning *`,
    [
      id("staff"),
      input.eventSlug,
      input.assignmentType === "personal" ? input.personId : null,
      input.label.trim(),
      input.assignmentType,
      input.token ? hashStaffToken(input.token) : null,
      JSON.stringify(input.permissions),
      JSON.stringify(input.scope ?? {}),
      input.expiresAt ?? null,
      input.rolePreset ?? null,
      input.invitationState ?? "active",
      input.invitedEmailHash ?? null,
      input.invitationLinkId ?? null,
      input.roleId,
      input.invitedEmailHint ?? null,
      input.invitationDelivery ?? (input.assignmentType === "station" ? "station" : "email"),
    ],
  );
  const row = result.rows[0] ?? null;
  if (!row) throw new Error("Staff assignment could not be created");
  return toStaffAssignment(row);
}

export async function listStaffAssignments(eventSlug: string): Promise<StoredStaffAssignment[]> {
  const rows = await query<StaffAssignmentRow>(
    `select assignments.*,
            coalesce(assignments.invited_email_hint, identity.display_hint) as assigned_email_hint,
            people.canonical_name as person_name
       from score_staff_assignments assignments
       left join event_people people on people.id = assignments.person_id
       left join lateral (
         select identifiers.display_hint
           from event_person_identifiers identifiers
          where identifiers.person_id = assignments.person_id
            and identifiers.kind = 'email' and identifiers.verified_at is not null
          order by identifiers.verified_at desc, identifiers.id limit 1
       ) identity on true
      where assignments.event_slug = $1 order by assignments.created_at desc, assignments.id`,
    [eventSlug],
  );
  return rows.map(toStaffAssignment);
}

function toStaffAssignment(row: StaffAssignmentRow): StoredStaffAssignment {
  return {
    id: row.id,
    eventSlug: row.event_slug,
    personId: row.person_id ?? undefined,
    label: row.label,
    assignmentType: row.assignment_type as StaffAssignmentType,
    permissions: recordObject(row.permissions) as unknown as StaffPermissionSet,
    scope: recordObject(row.scope),
    status: row.status as StaffAssignmentStatus,
    expiresAt: iso(row.expires_at),
    revokedAt: iso(row.revoked_at),
    rolePreset: row.role_preset ?? undefined,
    invitationState:
      row.invitation_state === "pending" ||
      row.invitation_state === "declined" ||
      row.invitation_state === "expired" ||
      row.invitation_state === "revoked"
        ? row.invitation_state
        : "active",
    activatedAt: iso(row.activated_at ?? null),
    lastUsedAt: iso(row.last_used_at ?? null),
    roleId: row.role_id,
    invitedEmailHint: row.invited_email_hint ?? undefined,
    invitationDelivery:
      row.invitation_delivery === "copy" ||
      row.invitation_delivery === "direct" ||
      row.invitation_delivery === "station"
        ? row.invitation_delivery
        : "email",
    assignedEmailHint: row.assigned_email_hint ?? undefined,
    personName: row.person_name ?? undefined,
  };
}

export async function resolveStaffAssignment(
  eventSlug: string,
  token: string,
): Promise<StoredStaffAssignment | null> {
  const row = await queryOne<StaffAssignmentRow>(
    `update score_staff_assignments
        set status = case when expires_at is not null and expires_at <= now() then 'expired' else status end
      where event_slug = $1 and assignment_type = 'station' and token_hash = $2
        and invitation_state = 'active'
      returning *`,
    [eventSlug, hashStaffToken(token)],
  );
  if (!row || row.status !== "active" || (row.expires_at && row.expires_at <= new Date()))
    return null;
  return toStaffAssignment(row);
}

export async function resolvePersonalStaffAssignment(
  eventSlug: string,
  personId: string,
): Promise<StoredStaffAssignment | null> {
  const row = await queryOne<StaffAssignmentRow>(
    `update score_staff_assignments
        set status = case when expires_at is not null and expires_at <= now() then 'expired' else status end,
            invitation_state = case
              when expires_at is not null and expires_at <= now() then 'expired'
              else invitation_state end,
            last_used_at = now()
      where event_slug = $1 and person_id = $2 and assignment_type = 'personal'
        and invitation_state = 'active'
      returning *`,
    [eventSlug, personId],
  );
  if (!row || row.status !== "active" || (row.expires_at && row.expires_at <= new Date()))
    return null;
  return toStaffAssignment(row);
}

export async function resolvePersonalStaffAssignments(
  eventSlug: string,
  personId: string,
): Promise<StoredStaffAssignment[]> {
  const rows = await query<StaffAssignmentRow>(
    `update score_staff_assignments
        set status = case when expires_at is not null and expires_at <= now() then 'expired' else status end,
            invitation_state = case
              when expires_at is not null and expires_at <= now() then 'expired'
              else invitation_state end,
            last_used_at = now()
      where event_slug = $1 and person_id = $2 and assignment_type = 'personal'
        and invitation_state = 'active'
      returning *`,
    [eventSlug, personId],
  );
  return rows
    .filter((row) => row.status === "active" && (!row.expires_at || row.expires_at > new Date()))
    .map(toStaffAssignment);
}

export async function revokeStaffAssignment(
  eventSlug: string,
  assignmentId: string,
): Promise<boolean> {
  const rows = await query(
    `update score_staff_assignments
        set status = 'revoked',
            invitation_state = case when assignment_type = 'personal' then 'revoked' else invitation_state end,
            revoked_at = now()
      where id = $1 and event_slug = $2 and revoked_at is null
      returning id`,
    [assignmentId, eventSlug],
  );
  return rows.length > 0;
}

export async function recordStaffDevice(assignmentId: string, deviceId: string): Promise<boolean> {
  const rows = await query(
    `insert into score_staff_devices (assignment_id, device_id)
     values ($1,$2)
     on conflict (assignment_id, device_id) do update set last_seen_at = now()
       where score_staff_devices.revoked_at is null
     returning assignment_id`,
    [assignmentId, deviceId],
  );
  return rows.length > 0;
}

export async function listStaffDevices(assignmentId: string): Promise<StoredStaffDevice[]> {
  const rows = await query<{
    assignment_id: string;
    device_id: string;
    last_seen_at: Date;
    revoked_at: Date | null;
  }>(
    `select assignment_id, device_id, last_seen_at, revoked_at
       from score_staff_devices where assignment_id = $1 order by last_seen_at desc, device_id`,
    [assignmentId],
  );
  return rows.map((row) => ({
    assignmentId: row.assignment_id,
    deviceId: row.device_id,
    lastSeenAt: row.last_seen_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString(),
  }));
}

export async function revokeStaffDevice(input: {
  eventSlug: string;
  assignmentId: string;
  deviceId: string;
}): Promise<boolean> {
  const rows = await query(
    `update score_staff_devices devices set revoked_at = now()
      from score_staff_assignments assignments
     where devices.assignment_id = assignments.id
       and assignments.event_slug = $1
       and devices.assignment_id = $2
       and devices.device_id = $3
       and devices.revoked_at is null
     returning devices.assignment_id`,
    [input.eventSlug, input.assignmentId, input.deviceId],
  );
  return rows.length > 0;
}
