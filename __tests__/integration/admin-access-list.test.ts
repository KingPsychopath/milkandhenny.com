import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { listNamedAdminGrants } from "@/features/attendee-operations/access-grants.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

describeWithDatabase("named admin access (postgres)", () => {
  beforeAll(applySchema);
  beforeEach(truncateAll);
  afterAll(closeDatabase);

  it("lists a named administrator with their verified identity", async () => {
    await query(
      `insert into event_people (id,canonical_name) values ('person_admin','Admin Person')`,
    );
    await query(
      `insert into event_person_identifiers
         (id,person_id,kind,value_hash,verified_at,display_hint)
       values ('identifier_admin','person_admin','email',$1,now(),'a•••@example.com')`,
      ["a".repeat(64)],
    );
    await query(
      `insert into global_admin_grants
         (id,person_id,role_preset,status,issued_by_type,issued_by_id,activated_at)
       values ('admin_grant_test','person_admin','admin','active','root-owner','owner',now())`,
    );

    await expect(listNamedAdminGrants()).resolves.toEqual([
      expect.objectContaining({
        id: "admin_grant_test",
        personId: "person_admin",
        name: "Admin Person",
        emailHint: "a•••@example.com",
        rolePreset: "admin",
        status: "active",
      }),
    ]);
  });
});
