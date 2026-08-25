import { createTeam, setTeamMembership } from "../store.server";
import {
  adjustStaffPool,
  createStaffAccess,
  issueStaffPool,
  revokeStaffAccess,
  revokeStaffAccessDevice,
  type StaffPreset,
} from "../staff.server";
import { STAFF_PERMISSIONS } from "../types";
import { resultResponse, stringValue, type AdminScoringActionHandlers } from "./shared";

const STAFF_PRESETS: ReadonlySet<string> = new Set([
  "door-scanner",
  "door-manager",
  "game-moderator",
  "points-marshal",
  "activity-manager",
  "event-manager",
  "admin",
]);

export const staffingActions: AdminScoringActionHandlers = {
  "create-team": async ({ eventSlug, body }) => {
    const name = stringValue(body.name);
    if (!name) return Response.json({ error: "Team name is required" }, { status: 400 });
    return resultResponse(await createTeam({ eventSlug, name }), "team", 201);
  },

  "assign-team": async ({ eventSlug, body }) => {
    const teamId = stringValue(body.teamId);
    const participantId = stringValue(body.participantId);
    if (!teamId || !participantId)
      return Response.json({ error: "Team and participant are required" }, { status: 400 });
    return resultResponse(
      await setTeamMembership({
        eventSlug,
        teamId,
        participantId,
        startsAt: stringValue(body.startsAt),
      }),
      "membership",
      201,
    );
  },

  "issue-pool": async ({ eventSlug, actorId, body }) => {
    const ownerType = body.ownerType;
    if (
      typeof body.points !== "number" ||
      (ownerType !== "event" &&
        ownerType !== "staff" &&
        ownerType !== "station" &&
        ownerType !== "activity")
    )
      return Response.json({ error: "Pool owner and whole points are required" }, { status: 400 });
    return resultResponse(
      await issueStaffPool({
        eventSlug,
        points: body.points,
        ownerType,
        ownerId: stringValue(body.ownerId),
        activityId: stringValue(body.activityId),
        actorId,
      }),
      "pool",
      201,
    );
  },

  "adjust-pool": async ({ eventSlug, actorId, body }) => {
    const poolId = stringValue(body.poolId);
    if (!poolId || typeof body.delta !== "number")
      return Response.json({ error: "Pool and adjustment are required" }, { status: 400 });
    return resultResponse(
      await adjustStaffPool({ eventSlug, poolId, delta: body.delta, actorId }),
      "pool",
    );
  },

  "create-staff": async ({ eventSlug, actorId, body }) => {
    const label = stringValue(body.label);
    const preset = stringValue(body.preset);
    const assignmentType =
      body.assignmentType === "station"
        ? "station"
        : body.assignmentType === "personal"
          ? "personal"
          : null;
    if (!label || !preset || !assignmentType || !STAFF_PRESETS.has(preset))
      return Response.json(
        { error: "Staff label, preset, and assignment type are required" },
        { status: 400 },
      );

    const assignment = await createStaffAccess({
      eventSlug,
      label,
      assignmentType,
      preset: preset as StaffPreset,
      actorId,
      overrides:
        body.overrides && typeof body.overrides === "object" && !Array.isArray(body.overrides)
          ? Object.fromEntries(
              STAFF_PERMISSIONS.flatMap((permission) => {
                const value = (body.overrides as Record<string, unknown>)[permission];
                return typeof value === "boolean" ? [[permission, value]] : [];
              }),
            )
          : undefined,
      scope:
        body.scope && typeof body.scope === "object" && !Array.isArray(body.scope)
          ? (body.scope as Record<string, unknown>)
          : undefined,
      expiresAt: stringValue(body.expiresAt),
    });
    return Response.json({ assignment }, { status: 201 });
  },

  "revoke-staff": async ({ eventSlug, actorId, body }) => {
    const assignmentId = stringValue(body.assignmentId);
    if (!assignmentId)
      return Response.json({ error: "Staff assignment is required" }, { status: 400 });
    const revoked = await revokeStaffAccess({ eventSlug, assignmentId, actorId });
    return revoked
      ? Response.json({ revoked: true })
      : Response.json({ error: "Active staff assignment not found" }, { status: 404 });
  },

  "revoke-staff-device": async ({ eventSlug, actorId, body }) => {
    const assignmentId = stringValue(body.assignmentId);
    const deviceId = stringValue(body.deviceId);
    if (!assignmentId || !deviceId)
      return Response.json({ error: "Staff assignment and device are required" }, { status: 400 });
    const revoked = await revokeStaffAccessDevice({ eventSlug, assignmentId, deviceId, actorId });
    return revoked
      ? Response.json({ revoked: true })
      : Response.json({ error: "Active staff device not found" }, { status: 404 });
  },
};
