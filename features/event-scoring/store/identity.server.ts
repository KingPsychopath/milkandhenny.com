import { randomUUID } from "node:crypto";

import { queryOne, transaction } from "@/lib/platform/postgres.server";
import { hash, id, type ScoreStoreResult } from "./common.server";

export async function markParticipantCheckedIn(
  participantId: string,
  checkedInAt?: Date,
): Promise<boolean> {
  return transaction(async (client) => {
    const effectiveCheckedInAt =
      checkedInAt ??
      (await client.query<{ at: Date }>(`select clock_timestamp() as at`)).rows[0]!.at;
    const selected = await client.query<{
      id: string;
      event_slug: string;
      checked_in_at: Date | null;
    }>(
      `select id,event_slug,checked_in_at from event_participants
        where id = $1 and status = 'active' for update`,
      [participantId],
    );
    const participant = selected.rows[0];
    if (!participant) return false;
    if (!participant.checked_in_at) {
      await client.query(
        `update event_participants set checked_in_at = $2, updated_at = now() where id = $1`,
        [participantId, effectiveCheckedInAt],
      );
    }
    const current = await client.query<{ id: string }>(
      `select id from score_team_memberships
        where participant_id = $1 and starts_at <= $2
          and (ends_at is null or ends_at > $2)
        order by starts_at desc limit 1`,
      [participantId, effectiveCheckedInAt],
    );
    if (current.rows[0]) return true;
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [participant.event_slug]);
    const team = await client.query<{ id: string }>(
      `select teams.id
         from score_teams teams
         left join score_team_memberships memberships
           on memberships.team_id = teams.id
          and memberships.starts_at <= $2
          and (memberships.ends_at is null or memberships.ends_at > $2)
         left join event_participants members
           on members.id = memberships.participant_id
          and members.status = 'active'
        where teams.event_slug = $1 and teams.status = 'active'
        group by teams.id
        order by count(members.id), teams.sort_order nulls last, teams.created_at, teams.id
        limit 1`,
      [participant.event_slug, effectiveCheckedInAt],
    );
    if (team.rows[0]) {
      await client.query(
        `insert into score_team_memberships
           (id,event_slug,team_id,participant_id,starts_at)
         values ($1,$2,$3,$4,$5)`,
        [id("tm"), participant.event_slug, team.rows[0].id, participantId, effectiveCheckedInAt],
      );
    }
    return true;
  });
}

export async function createPerson(input: { canonicalName?: string }): Promise<string> {
  const person = await queryOne<{ id: string }>(
    `insert into event_people (canonical_name) values ($1) returning id`,
    [input.canonicalName ?? null],
  );
  if (!person) throw new Error("Person could not be created");
  return person.id;
}

export async function attachPersonToParticipant(
  participantId: string,
  personId: string,
): Promise<ScoreStoreResult<void>> {
  const row = await queryOne<{ id: string }>(
    `update event_participants set person_id = $2, updated_at = now()
      where id = $1 and person_id is null returning id`,
    [participantId, personId],
  );
  if (!row) return { ok: false, status: 409, error: "This participant already has an identity" };
  return { ok: true, value: undefined };
}

export async function makeClaimToken(): Promise<{ token: string; tokenHash: string }> {
  const token = `claim_${randomUUID().replaceAll("-", "")}`;
  return { token, tokenHash: hash(token) };
}
