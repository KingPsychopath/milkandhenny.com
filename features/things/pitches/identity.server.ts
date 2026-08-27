import type { PoolClient } from "pg";

import { query } from "@/lib/platform/postgres.server";

export async function connectPitchDecksToVerifiedPerson(
  client: PoolClient,
  input: { personId: string; emailHash: string },
): Promise<number> {
  const result = await client.query(
    `update pitch_decks
        set owner_person_id = $1, updated_at = updated_at
      where owner_email_hash = $2
        and (owner_person_id is null or owner_person_id = $1)`,
    [input.personId, input.emailHash],
  );
  return result.rowCount ?? 0;
}

export async function verifiedPitchCreatorIdentity(input: {
  personId: string;
  emailHash: string;
}): Promise<{ personId: string; name: string; email: string } | null> {
  const rows = await query<{ canonical_name: string | null; email_address: string | null }>(
    `select person.canonical_name, identifier.email_address
       from event_people person
       join event_person_identifiers identifier on identifier.person_id = person.id
      where person.id = $1 and identifier.kind = 'email'
        and identifier.value_hash = $2 and identifier.verified_at is not null
        and identifier.historical_until is null
      limit 1`,
    [input.personId, input.emailHash],
  );
  const row = rows[0];
  if (!row?.email_address) return null;
  return {
    personId: input.personId,
    name: row.canonical_name?.trim() || "Pitch maker",
    email: row.email_address,
  };
}
