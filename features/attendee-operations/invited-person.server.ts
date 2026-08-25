import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import type { ActionLinkRecord } from "./action-links.server";

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

export async function ensurePendingInvitedPerson(
  client: PoolClient,
  input: { emailHash: string; emailHint: string; canonicalName?: string },
): Promise<{ personId: string; identifierId: string; verified: boolean }> {
  const existing = await client.query<{
    id: string;
    person_id: string;
    verified_at: Date | null;
  }>(
    `select id,person_id,verified_at from event_person_identifiers
      where kind = 'email' and value_hash = $1 for update`,
    [input.emailHash],
  );
  const found = existing.rows[0];
  if (found) {
    await client.query(
      `update event_person_identifiers set display_hint = coalesce(display_hint, $2) where id = $1`,
      [found.id, input.emailHint],
    );
    return {
      personId: found.person_id,
      identifierId: found.id,
      verified: Boolean(found.verified_at),
    };
  }

  const personId = id("person");
  const identifierId = id("identifier");
  await client.query(`insert into event_people (id,canonical_name) values ($1,$2)`, [
    personId,
    input.canonicalName?.trim() || null,
  ]);
  await client.query(
    `insert into event_person_identifiers
       (id,person_id,kind,value_hash,display_hint)
     values ($1,$2,'email',$3,$4)`,
    [identifierId, personId, input.emailHash, input.emailHint],
  );
  return { personId, identifierId, verified: false };
}

/**
 * Possession of an action link proves control of its destination mailbox.
 * Reuse the email's existing person when present; never merge it into the
 * person who happened to be signed in before opening the invitation.
 */
export async function createOrResolveInvitedPerson(
  client: PoolClient,
  link: Pick<ActionLinkRecord, "intendedEmailHash" | "intendedEmailHint">,
): Promise<{ personId: string; identifierId: string }> {
  const existing = await client.query<{ id: string; person_id: string }>(
    `select id,person_id from event_person_identifiers
      where kind = 'email' and value_hash = $1 for update`,
    [link.intendedEmailHash],
  );
  const found = existing.rows[0];
  if (found) {
    await client.query(
      `update event_person_identifiers
          set verified_at = coalesce(verified_at, now()), display_hint = coalesce(display_hint, $2)
        where id = $1`,
      [found.id, link.intendedEmailHint],
    );
    return { personId: found.person_id, identifierId: found.id };
  }

  const personId = id("person");
  const identifierId = id("identifier");
  await client.query(`insert into event_people (id) values ($1)`, [personId]);
  await client.query(
    `insert into event_person_identifiers
       (id,person_id,kind,value_hash,verified_at,display_hint)
     values ($1,$2,'email',$3,now(),$4)`,
    [identifierId, personId, link.intendedEmailHash, link.intendedEmailHint],
  );
  return { personId, identifierId };
}
