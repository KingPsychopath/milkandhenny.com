import { staffingActions } from "@/features/event-scoring/admin-api/staffing.server";
import {
  listStaffAssignments,
  listStaffDevices,
  listStaffRoles,
} from "@/features/event-scoring/store.server";

const STAFF_ACCESS_ACTIONS = new Set([
  "create-staff-role",
  "assign-staff-role",
  "archive-staff-role",
  "update-staff-role-scope",
  "revoke-staff",
  "revoke-staff-device",
]);

export async function readEventStaffAccess(eventSlug: string) {
  const [roles, assignments] = await Promise.all([
    listStaffRoles(eventSlug),
    listStaffAssignments(eventSlug),
  ]);

  return {
    roles,
    assignments: await Promise.all(
      assignments.map(async (assignment) => ({
        ...assignment,
        devices: await listStaffDevices(assignment.id),
      })),
    ),
  };
}

export async function runEventStaffAccessAction(input: {
  request: Request;
  eventSlug: string;
  actorId: string;
  body: Record<string, unknown>;
}) {
  const action = typeof input.body.action === "string" ? input.body.action : "";
  if (!STAFF_ACCESS_ACTIONS.has(action)) {
    return Response.json({ error: "Unsupported staff access action" }, { status: 400 });
  }
  return staffingActions[action](input);
}
