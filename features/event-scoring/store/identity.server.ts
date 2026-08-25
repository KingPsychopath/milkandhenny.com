import { randomUUID } from "node:crypto";

import { query, queryOne } from "@/lib/platform/postgres.server";
import { hash, id, type ScoreStoreResult } from "./common.server";

export async function markParticipantCheckedIn(
  participantId: string,
  checkedInAt = new Date(),
): Promise<boolean> {
  const rows = await query(
    `update event_participants set checked_in_at = coalesce(checked_in_at, $2), updated_at = now()
      where id = $1 and status = 'active'`,
    [participantId, checkedInAt],
  );
  return rows.length > 0;
}

export async function createPerson(input: {
  id?: string;
  canonicalName?: string;
}): Promise<string> {
  const personId = input.id ?? id("person");
  await query(`insert into event_people (id, canonical_name) values ($1,$2)`, [
    personId,
    input.canonicalName ?? null,
  ]);
  return personId;
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
