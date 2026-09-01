import { Effect } from "effect";

import { createTeam, setTeamMembership, shuffleCheckedInTeams } from "../store.server";
import { IdentityAcquisitionRestrictedError } from "@/features/attendee-operations/identity-policy.server";
import {
  adjustStaffPool,
  createStaffAccess,
  issueStaffPool,
  revokeStaffAccess,
  revokeStaffAccessDevice,
  type StaffPreset,
} from "../staff.server";
import { STAFF_PERMISSIONS } from "../types";
import { StaffAccessService } from "../staff-access-service.server";
import { runEventsResult } from "@/features/events/events-runtime.server";
import { resultResponse, stringValue, type AdminScoringActionHandlers } from "./shared";

const STAFF_PRESETS: ReadonlySet<string> = new Set([
  "door-scanner",
  "checkpoint-scanner",
  "door-manager",
  "game-moderator",
  "points-marshal",
  "activity-manager",
  "event-manager",
  "admin",
]);

function permissionOverrides(body: Record<string, unknown>) {
  return body.overrides && typeof body.overrides === "object" && !Array.isArray(body.overrides)
    ? Object.fromEntries(
        STAFF_PERMISSIONS.flatMap((permission) => {
          const value = (body.overrides as Record<string, unknown>)[permission];
          return typeof value === "boolean" ? [[permission, value]] : [];
        }),
      )
    : undefined;
}

function staffScope(body: Record<string, unknown>) {
  return body.scope && typeof body.scope === "object" && !Array.isArray(body.scope)
    ? (body.scope as Record<string, unknown>)
    : undefined;
}

export const staffingActions: AdminScoringActionHandlers = {
  "create-staff-role": async ({ eventSlug, actorId, body }) => {
    const label = stringValue(body.label);
    const preset = stringValue(body.preset);
    const reason = stringValue(body.reason);
    if (!label || !preset || !reason || !STAFF_PRESETS.has(preset))
      return Response.json(
        { error: "Role name, starting preset, and reason are required" },
        { status: 400 },
      );
    const result = await runEventsResult(
      Effect.gen(function* () {
        const service = yield* StaffAccessService;
        return yield* service.createRole({
          eventSlug,
          label,
          preset: preset as StaffPreset,
          actorId,
          reason,
          overrides: permissionOverrides(body),
          scope: staffScope(body),
          expiresAt: stringValue(body.expiresAt),
        });
      }),
    );
    return result.ok
      ? Response.json({ role: result.value }, { status: 201 })
      : Response.json({ error: result.error }, { status: result.status });
  },

  "assign-staff-role": async ({ request, eventSlug, actorId, body }) => {
    const roleId = stringValue(body.roleId);
    const reason = stringValue(body.reason);
    const delivery =
      body.delivery === "email" ||
      body.delivery === "copy" ||
      body.delivery === "direct" ||
      body.delivery === "station"
        ? body.delivery
        : null;
    if (!roleId || !reason || !delivery)
      return Response.json(
        { error: "Role, invitation method, and reason are required" },
        { status: 400 },
      );
    const result = await runEventsResult(
      Effect.gen(function* () {
        const service = yield* StaffAccessService;
        return yield* service.assignRole({
          eventSlug,
          roleId,
          delivery,
          actorId,
          reason,
          recipientEmail: stringValue(body.recipientEmail),
          origin: new URL(request.url).origin,
        });
      }),
    );
    return result.ok
      ? Response.json({ assignment: result.value }, { status: 201 })
      : Response.json({ error: result.error }, { status: result.status });
  },

  "shuffle-teams": async ({ eventSlug, actorId, body }) => {
    return resultResponse(
      await shuffleCheckedInTeams({
        eventSlug,
        teamCount: typeof body.teamCount === "number" ? body.teamCount : Number.NaN,
        actorType: "admin",
        actorId,
      }),
      "shuffle",
    );
  },

  "create-team": async ({ eventSlug, body }) => {
    const name = stringValue(body.name);
    if (!name) return Response.json({ error: "Team name is required" }, { status: 400 });
    return resultResponse(await createTeam({ eventSlug, name }), "team", 201);
  },

  "assign-team": async ({ eventSlug, body }) => {
    const teamId = stringValue(body.teamId);
    const participantId = stringValue(body.participantId);
    const startsAt = stringValue(body.startsAt);
    if (!teamId || !participantId)
      return Response.json({ error: "Team and participant are required" }, { status: 400 });
    if (startsAt && Number.isNaN(Date.parse(startsAt)))
      return Response.json(
        { error: "Team assignment start must be a valid time" },
        { status: 400 },
      );
    return resultResponse(
      await setTeamMembership({
        eventSlug,
        teamId,
        participantId,
        startsAt,
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

  "create-staff": async ({ request, eventSlug, actorId, body }) => {
    const label = stringValue(body.label);
    const preset = stringValue(body.preset);
    const reason = stringValue(body.reason);
    const assignmentType =
      body.assignmentType === "station"
        ? "station"
        : body.assignmentType === "personal"
          ? "personal"
          : null;
    if (!label || !preset || !assignmentType || !reason || !STAFF_PRESETS.has(preset))
      return Response.json(
        { error: "Staff label, preset, assignment type, and reason are required" },
        { status: 400 },
      );

    try {
      const assignment = await createStaffAccess({
        eventSlug,
        label,
        assignmentType,
        preset: preset as StaffPreset,
        actorId,
        reason,
        overrides: permissionOverrides(body),
        scope: staffScope(body),
        expiresAt: stringValue(body.expiresAt),
        recipientEmail: stringValue(body.recipientEmail),
        origin: new URL(request.url).origin,
      });
      return Response.json({ assignment }, { status: 201 });
    } catch (error) {
      if (error instanceof IdentityAcquisitionRestrictedError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  },

  "revoke-staff": async ({ eventSlug, actorId, body }) => {
    const assignmentId = stringValue(body.assignmentId);
    const reason = stringValue(body.reason);
    if (!assignmentId || !reason)
      return Response.json(
        { error: "Staff assignment and revocation reason are required" },
        { status: 400 },
      );
    const revoked = await revokeStaffAccess({ eventSlug, assignmentId, actorId, reason });
    return revoked
      ? Response.json({ revoked: true })
      : Response.json({ error: "Active staff assignment not found" }, { status: 404 });
  },

  "revoke-staff-device": async ({ eventSlug, actorId, body }) => {
    const assignmentId = stringValue(body.assignmentId);
    const deviceId = stringValue(body.deviceId);
    const reason = stringValue(body.reason);
    if (!assignmentId || !deviceId || !reason)
      return Response.json(
        { error: "Staff assignment, device, and revocation reason are required" },
        { status: 400 },
      );
    const revoked = await revokeStaffAccessDevice({
      eventSlug,
      assignmentId,
      deviceId,
      actorId,
      reason,
    });
    return revoked
      ? Response.json({ revoked: true })
      : Response.json({ error: "Active staff device not found" }, { status: 404 });
  },
};
