import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import {
  accountPermissionsForPeople,
  personHasAccountPermission,
  setAccountPermission,
} from "@/features/attendee-access/account-permissions.server";
import { query, queryOne } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

const PERSON_ID = "01990a1f-3b7c-7000-8000-000000000101";

describeWithDatabase("account transfer permissions", () => {
  beforeAll(applySchema);
  beforeEach(async () => {
    await truncateAll();
    await query("insert into event_people (id,canonical_name) values ($1,'Transfer Person')", [
      PERSON_ID,
    ]);
  });
  afterAll(closeDatabase);

  it("grants and revokes narrowly scoped transfer creation with an audit trail", async () => {
    await expect(
      setAccountPermission({
        personId: PERSON_ID,
        permission: "create_transfers",
        enabled: true,
        actorId: "operator",
        actorType: "admin",
        reason: "Needs to share event media",
      }),
    ).resolves.toEqual({ ok: true, value: { enabled: true } });
    await expect(personHasAccountPermission(PERSON_ID, "create_transfers")).resolves.toBe(true);
    await expect(accountPermissionsForPeople([PERSON_ID])).resolves.toEqual(
      new Map([[PERSON_ID, ["create_transfers"]]]),
    );

    await setAccountPermission({
      personId: PERSON_ID,
      permission: "create_transfers",
      enabled: false,
      actorId: "operator",
      actorType: "admin",
      reason: "Event work completed",
    });
    await expect(personHasAccountPermission(PERSON_ID, "create_transfers")).resolves.toBe(false);
    const audit = await query<{ action: string }>(
      `select action from attendee_operations_audit_events
        where entity_type = 'person' and entity_id = $1 order by created_at`,
      [PERSON_ID],
    );
    expect(audit.map((entry) => entry.action)).toEqual([
      "account.permission.granted",
      "account.permission.revoked",
    ]);
  });

  it("fails closed while the person is restricted", async () => {
    await query(
      "update event_people set acquisition_status = 'restricted', acquisition_restricted_at = now(), acquisition_restricted_by = 'test-operator', acquisition_restriction_reason = 'test restriction' where id = $1",
      [PERSON_ID],
    );
    const result = await setAccountPermission({
      personId: PERSON_ID,
      permission: "create_transfers",
      enabled: true,
      actorId: "owner",
      actorType: "root-owner",
      reason: "Should be blocked",
    });

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(
      await queryOne("select person_id from account_permission_grants where person_id = $1", [
        PERSON_ID,
      ]),
    ).toBeNull();
  });
});
