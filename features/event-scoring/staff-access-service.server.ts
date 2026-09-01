import { Context, Layer } from "effect";

import { staffAccessOperation } from "./staff-access-operation.server";
import { assignEventStaffRole, createEventStaffRole } from "./staff.server";

export class StaffAccessService extends Context.Service<
  StaffAccessService,
  {
    readonly createRole: typeof createRole;
    readonly assignRole: typeof assignRole;
  }
>()("StaffAccessService") {
  static readonly layer = Layer.succeed(this, { createRole, assignRole });
}

function createRole(input: Parameters<typeof createEventStaffRole>[0]) {
  return staffAccessOperation("role.create", "mutation", () => createEventStaffRole(input));
}

function assignRole(input: Parameters<typeof assignEventStaffRole>[0]) {
  return staffAccessOperation("role.assign", "mutation", () => assignEventStaffRole(input));
}
