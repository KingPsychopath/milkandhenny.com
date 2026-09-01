import { Context, Layer } from "effect";

import { staffAccessOperation } from "./staff-access-operation.server";
import {
  archiveEventStaffRole,
  assignEventStaffRole,
  createEventStaffRole,
  updateEventStaffRoleScope,
} from "./staff.server";

export class StaffAccessService extends Context.Service<
  StaffAccessService,
  {
    readonly createRole: typeof createRole;
    readonly assignRole: typeof assignRole;
    readonly updateRoleScope: typeof updateRoleScope;
    readonly archiveRole: typeof archiveRole;
  }
>()("StaffAccessService") {
  static readonly layer = Layer.succeed(this, {
    createRole,
    assignRole,
    updateRoleScope,
    archiveRole,
  });
}

function createRole(input: Parameters<typeof createEventStaffRole>[0]) {
  return staffAccessOperation("role.create", "mutation", () => createEventStaffRole(input));
}

function assignRole(input: Parameters<typeof assignEventStaffRole>[0]) {
  return staffAccessOperation("role.assign", "mutation", () => assignEventStaffRole(input));
}

function updateRoleScope(input: Parameters<typeof updateEventStaffRoleScope>[0]) {
  return staffAccessOperation("role.scope.update", "mutation", () =>
    updateEventStaffRoleScope(input),
  );
}

function archiveRole(input: Parameters<typeof archiveEventStaffRole>[0]) {
  return staffAccessOperation("role.archive", "mutation", () => archiveEventStaffRole(input));
}
