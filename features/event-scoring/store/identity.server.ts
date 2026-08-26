import { randomUUID } from "node:crypto";

import { query, queryOne } from "@/lib/platform/postgres.server";
import { hash, type ScoreStoreResult } from "./common.server";

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
