import type { PoolClient } from "pg";

import { query, transaction } from "@/lib/platform/postgres.server";
import type { AccountPermission } from "./account-permissions";

type PermissionUpdateResult =
  | { ok: true; value: { enabled: boolean } }
  | { ok: false; status: 400 | 404 | 409; error: string };

export async function personHasAccountPermission(
  personId: string,
  permission: AccountPermission,
): Promise<boolean> {
  const rows = await query<{ allowed: boolean }>(
    `select exists(
       select 1
         from account_permission_grants grant_record
         join event_people person on person.id = grant_record.person_id
        where grant_record.person_id = $1 and grant_record.permission = $2
          and person.acquisition_status = 'active'
     ) as allowed`,
    [personId, permission],
  );
  return rows[0]?.allowed === true;
}

export async function accountPermissionsForPeople(
  personIds: string[],
): Promise<Map<string, AccountPermission[]>> {
  if (!personIds.length) return new Map();
  const rows = await query<{ person_id: string; permission: AccountPermission }>(
    `select person_id,permission from account_permission_grants
      where person_id = any($1::uuid[]) order by permission`,
    [personIds],
  );
  const permissions = new Map<string, AccountPermission[]>();
  for (const row of rows) {
    const current = permissions.get(row.person_id) ?? [];
    current.push(row.permission);
    permissions.set(row.person_id, current);
  }
  return permissions;
}

async function recordPermissionAudit(
  client: PoolClient,
  input: {
    personId: string;
    permission: AccountPermission;
    enabled: boolean;
    actorId: string;
    actorType: "admin" | "root-owner";
    reason: string;
  },
): Promise<void> {
  await client.query(
    `insert into attendee_operations_audit_events
       (action,actor_type,actor_id,entity_type,entity_id,reason,after_state)
     values ($1,$2,$3,'person',$4,$5,$6::jsonb)`,
    [
      input.enabled ? "account.permission.granted" : "account.permission.revoked",
      input.actorType,
      input.actorId,
      input.personId,
      input.reason,
      JSON.stringify({ permission: input.permission, enabled: input.enabled }),
    ],
  );
}

export async function setAccountPermission(input: {
  personId: string;
  permission: AccountPermission;
  enabled: boolean;
  actorId: string;
  actorType: "admin" | "root-owner";
  reason: string;
}): Promise<PermissionUpdateResult> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    return { ok: false, status: 400, error: "Enter a reason between 3 and 500 characters" };
  }

  return transaction(async (client) => {
    const person = await client.query<{ acquisition_status: "active" | "restricted" }>(
      "select acquisition_status from event_people where id = $1 for update",
      [input.personId],
    );
    if (!person.rows[0]) return { ok: false, status: 404, error: "Person not found" };
    if (input.enabled && person.rows[0].acquisition_status !== "active") {
      return {
        ok: false,
        status: 409,
        error: "Restore this person’s permission acquisition before granting access",
      };
    }

    const changed = input.enabled
      ? await client.query(
          `insert into account_permission_grants
             (person_id,permission,granted_by_type,granted_by_id,grant_reason)
           values ($1,$2,$3,$4,$5)
           on conflict (person_id,permission) do nothing`,
          [input.personId, input.permission, input.actorType, input.actorId, reason],
        )
      : await client.query(
          "delete from account_permission_grants where person_id = $1 and permission = $2",
          [input.personId, input.permission],
        );
    if (changed.rowCount) await recordPermissionAudit(client, { ...input, reason });
    return { ok: true, value: { enabled: input.enabled } };
  });
}
