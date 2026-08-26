import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { listNamedAdminGrants } from "@/features/attendee-operations/access-grants.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

const ADMIN_PERSON = "0198e9d8-53d7-7db5-9d79-ce28b87dc67f";
const ADMIN_IDENTIFIER = "0198e9d8-53d7-7db6-86ac-b58a99aa0ab0";

describeWithDatabase("named admin access (postgres)", () => {
  beforeAll(applySchema);
  beforeEach(truncateAll);
  afterAll(closeDatabase);

  it("lists a named administrator with their verified identity", async () => {
    await query(`insert into event_people (id,canonical_name) values ($1,'Admin Person')`, [
      ADMIN_PERSON,
    ]);
    await query(
      `insert into event_person_identifiers
         (id,person_id,kind,value_hash,verified_at,display_hint)
       values ($1,$2,'email',$3,now(),'a•••@example.com')`,
      [ADMIN_IDENTIFIER, ADMIN_PERSON, "a".repeat(64)],
    );
    await query(
      `insert into global_admin_grants
         (id,person_id,role_preset,status,issued_by_type,issued_by_id,activated_at)
       values ('admin_grant_test',$1,'admin','active','root-owner','owner',now())`,
      [ADMIN_PERSON],
    );

    await expect(listNamedAdminGrants()).resolves.toEqual([
      expect.objectContaining({
        id: "admin_grant_test",
        personId: ADMIN_PERSON,
        name: "Admin Person",
        emailHint: "a•••@example.com",
        rolePreset: "admin",
        status: "active",
      }),
    ]);
  });
});
