import { createHash, randomUUID } from "node:crypto";

import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import {
  canAutomaticallyMergeIdentity,
  identityEvidenceStrength,
  type IdentityEvidenceKind,
} from "./types";
import {
  attachPersonToParticipant,
  createPerson,
  getParticipant,
  type ScoreStoreResult,
} from "./store.server";

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value.trim().toLocaleLowerCase("en-GB")).digest("hex");
}

export type IdentityResolution =
  | { state: "attached"; personId: string }
  | { state: "review"; candidateParticipantIds: string[]; reason: string };

export function classifyIdentityEvidence(kinds: readonly IdentityEvidenceKind[]): {
  strong: IdentityEvidenceKind[];
  weak: IdentityEvidenceKind[];
  automatic: boolean;
} {
  const strong = kinds.filter((kind) => identityEvidenceStrength(kind) === "strong");
  const weak = kinds.filter((kind) => identityEvidenceStrength(kind) === "weak");
  return { strong, weak, automatic: canAutomaticallyMergeIdentity(kinds) && strong.length >= 2 };
}

export async function createPersonIdentity(input: {
  canonicalName?: string;
  identifier?: { kind: "email" | "account" | "passkey"; value: string; verified: boolean };
}): Promise<{ personId: string }> {
  const personId = await createPerson({ canonicalName: input.canonicalName });
  if (input.identifier) {
    await query(
      `insert into event_person_identifiers (id, person_id, kind, value_hash, verified_at)
       values ($1,$2,$3,$4,$5)`,
      [
        id("identifier"),
        personId,
        input.identifier.kind,
        digest(input.identifier.value),
        input.identifier.verified ? new Date() : null,
      ],
    );
  }
  return { personId };
}

export async function addVerifiedIdentifier(input: {
  personId: string;
  kind: "email" | "account" | "passkey";
  value: string;
}): Promise<ScoreStoreResult<void>> {
  const row = await queryOne<{ id: string }>(
    `insert into event_person_identifiers (id, person_id, kind, value_hash, verified_at)
     values ($1,$2,$3,$4,now())
     on conflict (kind, value_hash) do nothing
     returning id`,
    [id("identifier"), input.personId, input.kind, digest(input.value)],
  );
  return row
    ? { ok: true, value: undefined }
    : { ok: false, status: 409, error: "That identifier is already linked" };
}

export async function attachParticipantWithEvidence(input: {
  eventSlug: string;
  participantId: string;
  personId: string;
  evidence: readonly IdentityEvidenceKind[];
  actorId: string;
  reason: string;
}): Promise<IdentityResolution | { state: "error"; status: number; error: string }> {
  const participant = await getParticipant(input.participantId);
  if (!participant || participant.eventSlug !== input.eventSlug)
    return { state: "error", status: 404, error: "Participant not found" };
  const evidence = classifyIdentityEvidence(input.evidence);
  if (!evidence.automatic) {
    return {
      state: "review",
      candidateParticipantIds: [input.participantId],
      reason: "Identity evidence needs admin review",
    };
  }
  const attached = await attachPersonToParticipant(input.participantId, input.personId);
  if (!attached.ok) return { state: "error", status: attached.status, error: attached.error };
  await query(
    `insert into score_audit_events
      (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
     values ($1,'identity.participant.attached','admin',$2,'participant',$3,$4::jsonb)`,
    [
      input.eventSlug,
      input.actorId,
      input.participantId,
      JSON.stringify({ personId: input.personId, evidence: input.evidence, reason: input.reason }),
    ],
  );
  return { state: "attached", personId: input.personId };
}

export async function pseudonymizeEventPerson(input: {
  eventSlug: string;
  personId: string;
  actorId: string;
  reason: string;
}): Promise<ScoreStoreResult<{ participants: number }>> {
  if (!input.reason.trim())
    return { ok: false, status: 400, error: "A privacy action needs a reason" };
  return transaction(async (client) => {
    const participants = await client.query<{ id: string }>(
      `select id from event_participants
        where event_slug = $1 and person_id = $2 for update`,
      [input.eventSlug, input.personId],
    );
    if (participants.rows.length === 0)
      return { ok: false, status: 404, error: "Event person not found" };
    await client.query(`delete from event_person_identifiers where person_id = $1`, [
      input.personId,
    ]);
    await client.query(
      `update event_people set canonical_name = null, updated_at = now() where id = $1`,
      [input.personId],
    );
    for (const participant of participants.rows) {
      const alias = `removed-${createHash("sha256")
        .update(`${input.eventSlug}:${participant.id}:privacy`)
        .digest("hex")
        .slice(0, 10)}`;
      await client.query(
        `update event_participants
            set display_name = null, public_alias = $2, display_mode = 'anonymous', updated_at = now()
          where id = $1`,
        [participant.id, alias],
      );
    }
    await client.query(
      `insert into score_audit_events
         (event_slug,action,actor_type,actor_id,entity_type,entity_id,metadata)
       values ($1,'privacy.person.pseudonymized','admin',$2,'person',$3,$4::jsonb)`,
      [
        input.eventSlug,
        input.actorId,
        input.personId,
        JSON.stringify({ participantCount: participants.rows.length, reason: input.reason }),
      ],
    );
    return { ok: true, value: { participants: participants.rows.length } };
  });
}
