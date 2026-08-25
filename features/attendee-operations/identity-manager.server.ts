import { revokeAttendeeSessionsForPerson } from "@/features/event-scoring/session.server";
import { queryOne, transaction } from "@/lib/platform/postgres.server";

export type PersonAcquisitionStatus = "active" | "restricted";

export type PersonAcquisitionState = {
  status: PersonAcquisitionStatus;
  restrictedAt?: string;
  restrictedBy?: string;
  restrictionReason?: string;
};

type ActorType = "root-owner" | "admin";

export type IdentityManagerResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

function normalizedReason(value: string): string {
  const reason = value.trim().replace(/\s+/g, " ");
  if (reason.length < 3 || reason.length > 500) {
    throw new Error("Enter a reason between 3 and 500 characters");
  }
  return reason;
}

export async function restrictPersonAcquisition(input: {
  personId: string;
  actorId: string;
  actorType: ActorType;
  reason: string;
}): Promise<{ state: PersonAcquisitionState; revokedPendingPermissions: number } | null> {
  const reason = normalizedReason(input.reason);
  const state = await transaction(async (client) => {
    const selected = await client.query<{
      acquisition_status: PersonAcquisitionStatus;
      acquisition_restricted_at: Date | null;
      acquisition_restricted_by: string | null;
      acquisition_restriction_reason: string | null;
    }>(
      `select acquisition_status,acquisition_restricted_at,acquisition_restricted_by,
              acquisition_restriction_reason
         from event_people where id = $1 for update`,
      [input.personId],
    );
    const before = selected.rows[0];
    if (!before) return null;
    const updated = await client.query<{
      acquisition_status: PersonAcquisitionStatus;
      acquisition_restricted_at: Date;
      acquisition_restricted_by: string;
      acquisition_restriction_reason: string;
    }>(
      `update event_people
          set acquisition_status = 'restricted',acquisition_restricted_at = now(),
              acquisition_restricted_by = $2,acquisition_restriction_reason = $3,updated_at = now()
        where id = $1
        returning acquisition_status,acquisition_restricted_at,acquisition_restricted_by,
                  acquisition_restriction_reason`,
      [input.personId, input.actorId, reason],
    );
    const revokedAdmin = await client.query<{ invitation_link_id: string | null }>(
      `update global_admin_grants
          set status = 'revoked',revoked_at = now()
        where person_id = $1 and status = 'pending'
        returning invitation_link_id`,
      [input.personId],
    );
    const revokedStaff = await client.query<{ invitation_link_id: string | null }>(
      `update score_staff_assignments
          set status = 'revoked',invitation_state = 'revoked',revoked_at = now()
        where person_id = $1 and status = 'active' and invitation_state = 'pending'
        returning invitation_link_id`,
      [input.personId],
    );
    const linkIds = [...revokedAdmin.rows, ...revokedStaff.rows]
      .map((row) => row.invitation_link_id)
      .filter((linkId): linkId is string => Boolean(linkId));
    if (linkIds.length > 0) {
      await client.query(
        `update attendee_action_links
            set revoked_at = coalesce(revoked_at,now()),
                revoke_reason = coalesce(revoke_reason,'identity-acquisition-restricted')
          where id = any($1::text[]) and consumed_at is null and revoked_at is null`,
        [linkIds],
      );
    }
    const revokedPendingPermissions = (revokedAdmin.rowCount ?? 0) + (revokedStaff.rowCount ?? 0);
    await client.query(
      `insert into attendee_operations_audit_events
         (action,actor_type,actor_id,entity_type,entity_id,before_state,after_state,reason,affected_count)
       values ('identity.acquisition.restricted',$1,$2,'person',$3,$4::jsonb,$5::jsonb,$6,$7)`,
      [
        input.actorType,
        input.actorId,
        input.personId,
        JSON.stringify({ status: before.acquisition_status }),
        JSON.stringify({ status: "restricted" }),
        reason,
        revokedPendingPermissions,
      ],
    );
    const row = updated.rows[0];
    if (!row) return null;
    return {
      state: {
        status: row.acquisition_status,
        restrictedAt: row.acquisition_restricted_at.toISOString(),
        restrictedBy: row.acquisition_restricted_by,
        restrictionReason: row.acquisition_restriction_reason,
      } satisfies PersonAcquisitionState,
      revokedPendingPermissions,
    };
  });
  return state;
}

export async function restorePersonAcquisition(input: {
  personId: string;
  actorId: string;
  actorType: ActorType;
  reason: string;
}): Promise<PersonAcquisitionState | null> {
  const reason = normalizedReason(input.reason);
  return transaction(async (client) => {
    const selected = await client.query<{ acquisition_status: PersonAcquisitionStatus }>(
      `select acquisition_status from event_people where id = $1 for update`,
      [input.personId],
    );
    const before = selected.rows[0];
    if (!before) return null;
    await client.query(
      `update event_people
          set acquisition_status = 'active',acquisition_restricted_at = null,
              acquisition_restricted_by = null,acquisition_restriction_reason = null,
              updated_at = now()
        where id = $1`,
      [input.personId],
    );
    await client.query(
      `insert into attendee_operations_audit_events
         (action,actor_type,actor_id,entity_type,entity_id,before_state,after_state,reason)
       values ('identity.acquisition.restored',$1,$2,'person',$3,$4::jsonb,$5::jsonb,$6)`,
      [
        input.actorType,
        input.actorId,
        input.personId,
        JSON.stringify({ status: before.acquisition_status }),
        JSON.stringify({ status: "active" }),
        reason,
      ],
    );
    return { status: "active" };
  });
}

export async function forceSignOutPerson(input: {
  personId: string;
  actorId: string;
  actorType: ActorType;
  reason: string;
}): Promise<{ revokedSessions: number } | null> {
  const reason = normalizedReason(input.reason);
  const person = await queryOne<{ id: string }>(`select id from event_people where id = $1`, [
    input.personId,
  ]);
  if (!person) return null;
  const revokedSessions = await revokeAttendeeSessionsForPerson(input.personId);
  await transaction(async (client) => {
    await client.query(
      `insert into attendee_operations_audit_events
         (action,actor_type,actor_id,entity_type,entity_id,before_state,after_state,reason,affected_count)
       values ('identity.sessions.revoked',$1,$2,'person',$3,$4::jsonb,$5::jsonb,$6,$7)`,
      [
        input.actorType,
        input.actorId,
        input.personId,
        JSON.stringify({ activeSessions: revokedSessions }),
        JSON.stringify({ activeSessions: 0 }),
        reason,
        revokedSessions,
      ],
    );
  });
  return { revokedSessions };
}

export async function removePersonEmail(input: {
  personId: string;
  identifierId: string;
  actorId: string;
  actorType: ActorType | "attendee";
  reason: string;
}): Promise<IdentityManagerResult<{ removed: true; revokedSessions: number }>> {
  const reason = normalizedReason(input.reason);
  const removed: IdentityManagerResult<{ removed: true }> = await transaction(async (client) => {
    const selected = await client.query<{
      id: string;
      verified_at: Date | null;
    }>(
      `select id,verified_at
         from event_person_identifiers
        where person_id = $1 and kind = 'email'
        for update`,
      [input.personId],
    );
    const target = selected.rows.find((identifier) => identifier.id === input.identifierId);
    if (!target?.verified_at) {
      return { ok: false, error: "Verified email not found", status: 404 };
    }
    const activeCount = selected.rows.filter((identifier) => identifier.verified_at).length;
    if (activeCount <= 1) {
      return {
        ok: false,
        error: "Add and verify another email before removing the only sign-in email",
        status: 409,
      };
    }
    await client.query(
      `update event_person_identifiers
          set verified_at = null,historical_until = now()
        where id = $1`,
      [target.id],
    );
    await client.query(
      `insert into attendee_operations_audit_events
         (action,actor_type,actor_id,entity_type,entity_id,before_state,after_state,reason,affected_count)
       values ('identity.email.removed',$1,$2,'person',$3,$4::jsonb,$5::jsonb,$6,1)`,
      [
        input.actorType,
        input.actorId,
        input.personId,
        JSON.stringify({ identifierId: target.id, status: "verified" }),
        JSON.stringify({ identifierId: target.id, status: "removed" }),
        reason,
      ],
    );
    return { ok: true, value: { removed: true } };
  });
  if (!removed.ok) return removed;
  const revokedSessions = await revokeAttendeeSessionsForPerson(input.personId);
  return { ok: true, value: { removed: true, revokedSessions } };
}
