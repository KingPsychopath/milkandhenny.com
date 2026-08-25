import { randomBytes } from "node:crypto";

import { query } from "@/lib/platform/postgres.server";

import {
  createStaffAssignment,
  createPool,
  recordStaffDevice,
  resolveStaffAssignment,
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
  "game-moderator": ["runActivities", "viewParticipantPoints"] as const,
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

export type StaffAccess = StoredStaffAssignment & { token?: string };

export async function createStaffAccess(input: {
  eventSlug: string;
  label: string;
  assignmentType: StaffAssignmentType;
  preset: StaffPreset;
  overrides?: Partial<StaffPermissionSet>;
  scope?: Record<string, unknown>;
  expiresAt?: string;
  actorId: string;
}): Promise<StaffAccess> {
  const token = `staff_${randomBytes(24).toString("base64url")}`;
  const assignment = await createStaffAssignment({
    eventSlug: input.eventSlug,
    label: input.label,
    assignmentType: input.assignmentType,
    token,
    permissions: permissionsForPreset(input.preset, input.overrides),
    scope: input.scope,
    expiresAt: input.expiresAt,
  });
  await query(
    `insert into score_audit_events
       (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
     values ($1,'staff.assignment.created','admin',$2,'staff_assignment',$3,$4::jsonb)`,
    [
      input.eventSlug,
      input.actorId,
      assignment.id,
      JSON.stringify({ assignmentType: input.assignmentType, label: input.label }),
    ],
  );
  return { ...assignment, token };
}

export async function resolveStaffAccess(input: {
  eventSlug: string;
  token: string;
  deviceId?: string;
}): Promise<StoredStaffAssignment | null> {
  const assignment = await resolveStaffAssignment(input.eventSlug, input.token);
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
}) {
  return createPool(input);
}

export async function revokeStaffAccess(input: {
  eventSlug: string;
  assignmentId: string;
  actorId: string;
}): Promise<boolean> {
  const revoked = await revokeStaffAssignment(input.eventSlug, input.assignmentId);
  if (!revoked) return false;
  await query(
    `insert into score_audit_events
       (event_slug, action, actor_type, actor_id, entity_type, entity_id)
     values ($1,'staff.assignment.revoked','admin',$2,'staff_assignment',$3)`,
    [input.eventSlug, input.actorId, input.assignmentId],
  );
  return true;
}

export async function revokeStaffAccessDevice(input: {
  eventSlug: string;
  assignmentId: string;
  deviceId: string;
  actorId: string;
}): Promise<boolean> {
  const revoked = await revokeStoredStaffDevice(input);
  if (!revoked) return false;
  await query(
    `insert into score_audit_events
       (event_slug, action, actor_type, actor_id, assignment_id, device_id, entity_type, entity_id)
     values ($1,'staff.device.revoked','admin',$2,$3,$4,'staff_device',$4)`,
    [input.eventSlug, input.actorId, input.assignmentId, input.deviceId],
  );
  return true;
}
