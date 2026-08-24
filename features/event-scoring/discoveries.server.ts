import { createHash, createHmac, randomUUID } from "node:crypto";

import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import { getEvent } from "@/features/events/store.server";
import { getTicket } from "@/features/tickets/store.server";
import {
  discoveryClaimPoints,
  isWithinWindow,
  normalizeDiscoveryCode,
  type DiscoveryRule,
  type DiscoveryClaimState,
} from "./types";
import { getActivity, getOrCreateSettings, getParticipant, recordScore } from "./store.server";

type DiscoveryRow = {
  id: string;
  event_slug: string;
  activity_id: string;
  name: string;
  method: string;
  status: string;
  rule: unknown;
  replacement_revision: number;
};

export type Discovery = {
  id: string;
  eventSlug: string;
  activityId: string;
  name: string;
  method: "qr" | "code" | "word" | "phrase" | "collected-clues";
  status: DiscoveryRow["status"];
  rule: DiscoveryRule;
  replacementRevision: number;
};

export type DiscoverySetup = Discovery & { claimToken?: string; code?: string };

export type DiscoveryResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function credentialKey(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set before discovery credentials can be issued");
  }
  return "local-event-discovery-credential-key";
}

export function discoveryCredential(input: {
  discoveryId: string;
  method: Discovery["method"];
  revision: number;
}): string {
  const payload = `${input.discoveryId}:${input.method}:${input.revision}`;
  const value = createHmac("sha256", credentialKey()).update(payload).digest("base64url");
  return input.method === "qr" ? `clue_${value}` : normalizeDiscoveryCode(value.slice(0, 14));
}

function toDiscovery(row: DiscoveryRow): Discovery {
  return {
    id: row.id,
    eventSlug: row.event_slug,
    activityId: row.activity_id,
    name: row.name,
    method: row.method as Discovery["method"],
    status: row.status,
    rule: row.rule as DiscoveryRule,
    replacementRevision: row.replacement_revision,
  };
}

export async function createDiscovery(input: {
  eventSlug: string;
  activityId: string;
  name: string;
  method: Discovery["method"];
  status?: DiscoveryRow["status"];
  rule: DiscoveryRule;
  includeSecret?: boolean;
}): Promise<DiscoveryResult<DiscoverySetup>> {
  const event = await getEvent(input.eventSlug);
  if (!event) return { ok: false, status: 404, error: "Event not found" };
  const activity = await getActivity(input.activityId);
  if (!activity || activity.eventSlug !== input.eventSlug)
    return { ok: false, status: 404, error: "Activity not found" };
  if (!input.name.trim()) return { ok: false, status: 400, error: "Name the discovery" };
  const discoveryId = id("disc");
  const secret =
    input.method === "qr"
      ? discoveryCredential({ discoveryId, method: input.method, revision: 1 })
      : null;
  const code =
    input.method === "code" || input.method === "word" || input.method === "phrase"
      ? discoveryCredential({ discoveryId, method: input.method, revision: 1 })
      : null;
  const row = await queryOne<DiscoveryRow>(
    `insert into score_discoveries
       (id, event_slug, activity_id, name, method, status, token_hash, code_hash, rule)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     returning id, event_slug, activity_id, name, method, status, rule, replacement_revision`,
    [
      discoveryId,
      input.eventSlug,
      input.activityId,
      input.name.trim(),
      input.method,
      input.status ?? "draft",
      secret ? digest(secret) : null,
      code ? digest(normalizeDiscoveryCode(code)) : null,
      JSON.stringify(input.rule),
    ],
  );
  if (!row) return { ok: false, status: 500, error: "Discovery could not be created" };
  return {
    ok: true,
    value: {
      ...toDiscovery(row),
      claimToken: input.includeSecret === false ? undefined : (secret ?? undefined),
      code: input.includeSecret === false ? undefined : (code ?? undefined),
    },
  };
}

export async function getDiscovery(discoveryId: string): Promise<Discovery | null> {
  const row = await queryOne<DiscoveryRow>(
    `select id, event_slug, activity_id, name, method, status, rule, replacement_revision
       from score_discoveries where id = $1`,
    [discoveryId],
  );
  return row ? toDiscovery(row) : null;
}

export async function listDiscoveries(eventSlug: string): Promise<Discovery[]> {
  const rows = await query<DiscoveryRow>(
    `select id, event_slug, activity_id, name, method, status, rule, replacement_revision
       from score_discoveries where event_slug = $1 order by created_at desc, id`,
    [eventSlug],
  );
  return rows.map(toDiscovery);
}

export async function replaceDiscoverySecret(input: {
  discoveryId: string;
  actorId: string;
}): Promise<DiscoveryResult<{ claimToken: string; replacementRevision: number }>> {
  const current = await queryOne<{
    event_slug: string;
    method: Discovery["method"];
    replacement_revision: number;
  }>(
    `select event_slug, method, replacement_revision
       from score_discoveries where id = $1`,
    [input.discoveryId],
  );
  if (!current) return { ok: false, status: 404, error: "Discovery not found" };
  const replacementRevision = current.replacement_revision + 1;
  const credential = discoveryCredential({
    discoveryId: input.discoveryId,
    method: current.method,
    revision: replacementRevision,
  });
  const column = current.method === "qr" ? "token_hash" : "code_hash";
  const row = await queryOne<{ event_slug: string; replacement_revision: number }>(
    `update score_discoveries
        set ${column} = $2, replacement_revision = $3, updated_at = now()
      where id = $1
      returning event_slug, replacement_revision`,
    [input.discoveryId, digest(credential), replacementRevision],
  );
  if (!row) return { ok: false, status: 404, error: "Discovery not found" };
  await query(
    `insert into score_audit_events
      (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
     values ($1,'discovery.secret.replaced','admin',$2,'discovery',$3,$4::jsonb)`,
    [
      row.event_slug,
      input.actorId,
      input.discoveryId,
      JSON.stringify({ revision: row.replacement_revision }),
    ],
  );
  return {
    ok: true,
    value: {
      claimToken: credential,
      replacementRevision: row.replacement_revision,
    },
  };
}

async function resolveDiscovery(discovery: Discovery, value: string): Promise<boolean> {
  if (discovery.method === "qr") {
    const row = await queryOne<{ id: string }>(
      `select id from score_discoveries where id = $1 and token_hash = $2`,
      [discovery.id, digest(value)],
    );
    return Boolean(row);
  }
  const row = await queryOne<{ id: string }>(
    `select id from score_discoveries where id = $1 and code_hash = $2`,
    [discovery.id, digest(normalizeDiscoveryCode(value))],
  );
  return Boolean(row);
}

export async function claimDiscovery(input: {
  discoveryId: string;
  participantId: string;
  presented: string;
  commandId: string;
  clueKey?: string;
}): Promise<DiscoveryResult<{ state: DiscoveryClaimState; points: number; transaction?: string }>> {
  const discovery = await getDiscovery(input.discoveryId);
  if (!discovery) return { ok: false, status: 404, error: "Discovery not found" };
  const participant = await getParticipant(input.participantId);
  if (!participant || participant.eventSlug !== discovery.eventSlug)
    return { ok: false, status: 404, error: "Participant not found" };
  if (input.clueKey) {
    return { ok: false, status: 400, error: "A discovery can only be claimed once" };
  }
  if (discovery.status !== "live")
    return { ok: false, status: 409, error: "This discovery is not live" };
  if (!(await resolveDiscovery(discovery, input.presented)))
    return { ok: false, status: 400, error: "That clue does not match" };
  if (discovery.rule.requiresCheckIn && !participant.checkedInAt)
    return { ok: false, status: 409, error: "Check in before claiming this clue" };
  if (!isWithinWindow(Date.now(), discovery.rule.startsAt, discovery.rule.endsAt))
    return { ok: false, status: 409, error: "This clue is outside its time window" };
  if (
    discovery.rule.eligibleTeamIds &&
    (!participant.teamId || !discovery.rule.eligibleTeamIds.includes(participant.teamId))
  ) {
    return { ok: false, status: 403, error: "Your team cannot claim this clue" };
  }
  if (discovery.rule.eligibleTicketTypeIds) {
    const ticket = participant.ticketId ? await getTicket(participant.ticketId) : null;
    if (!ticket || !discovery.rule.eligibleTicketTypeIds.includes(ticket.ticketTypeId)) {
      return { ok: false, status: 403, error: "This ticket cannot claim the clue" };
    }
  }

  const settings = await getOrCreateSettings(discovery.eventSlug);
  const claimId = id("claim");
  const claim = await transaction(async (client) => {
    // Claim numbers must be allocated under one lock. Without this, two final
    // claims can both receive the same diminishing tier or exhaust a pool.
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [input.discoveryId]);
    const existing = await client.query<{
      id: string;
      state: DiscoveryClaimState;
      points: number;
      transaction_id: string | null;
    }>(
      `select id, state, points, transaction_id
         from score_discovery_claims
        where discovery_id = $1 and participant_id = $2 and clue_key is null`,
      [input.discoveryId, input.participantId],
    );
    if (existing.rows[0]) return { duplicate: existing.rows[0] };
    const claimNumberRows = await client.query<{ count: string; points: string }>(
      `select count(*)::text as count
         from score_discovery_claims
        where discovery_id = $1 and state in ('accepted', 'held')`,
      [input.discoveryId],
    );
    const claimNumber = Number(claimNumberRows.rows[0]?.count ?? 0) + 1;
    if (
      discovery.rule.claimantLimit !== undefined &&
      claimNumber > Math.max(0, Math.trunc(discovery.rule.claimantLimit))
    ) {
      return { limitReached: true };
    }
    const claimedPoints = await client.query<{ total: string }>(
      `select coalesce(sum(points), 0)::text as total
         from score_discovery_claims
        where discovery_id = $1 and state in ('accepted', 'held')`,
      [input.discoveryId],
    );
    let points = discoveryClaimPoints(
      discovery.rule,
      claimNumber,
      discovery.method === "collected-clues",
    );
    if (discovery.rule.pointMode === "fixed-pool" && discovery.rule.poolPoints !== undefined) {
      points = Math.min(
        points,
        Math.max(
          0,
          Math.trunc(discovery.rule.poolPoints) - Number(claimedPoints.rows[0]?.total ?? 0),
        ),
      );
    }
    if (points <= 0 && discovery.rule.pointMode === "fixed-pool") {
      return { limitReached: true };
    }
    const inserted = await client.query<{ id: string }>(
      `insert into score_discovery_claims
         (id, discovery_id, event_slug, participant_id, command_id, state, points, clue_key)
       values ($1,$2,$3,$4,$5,'held',$6,$7)
       on conflict do nothing
       returning id`,
      [
        claimId,
        input.discoveryId,
        discovery.eventSlug,
        input.participantId,
        input.commandId,
        points,
        null,
      ],
    );
    if (!inserted.rows[0]) {
      const duplicate = await client.query<{
        id: string;
        state: DiscoveryClaimState;
        points: number;
        transaction_id: string | null;
      }>(
        `select id, state, points, transaction_id
           from score_discovery_claims
          where discovery_id = $1 and participant_id = $2 and clue_key is null`,
        [input.discoveryId, input.participantId],
      );
      return duplicate.rows[0] ? { duplicate: duplicate.rows[0] } : { duplicate: null };
    }
    return { duplicate: null, claimId, points };
  });
  if ("limitReached" in claim && claim.limitReached) {
    return { ok: false, status: 409, error: "This discovery has no claimant points left" };
  }
  if (claim.duplicate) {
    if (claim.duplicate.state === "held" && !claim.duplicate.transaction_id) {
      if (settings.state !== "live") {
        return { ok: true, value: { state: "held", points: claim.duplicate.points } };
      }
      return settleDiscoveryClaim(
        discovery,
        input.participantId,
        claim.duplicate.id,
        claim.duplicate.points,
      );
    }
    return {
      ok: true,
      value: {
        state: claim.duplicate.state,
        points: claim.duplicate.points,
        transaction: claim.duplicate.transaction_id ?? undefined,
      },
    };
  }
  if (!claim.claimId)
    return { ok: false, status: 409, error: "This claim is already being processed" };
  const points = claim.points;
  if (settings.state !== "live") {
    await query(`update score_discovery_claims set state = 'held' where id = $1`, [claimId]);
    return { ok: true, value: { state: "held", points } };
  }
  return settleDiscoveryClaim(discovery, input.participantId, claimId, points);
}

async function settleDiscoveryClaim(
  discovery: Discovery,
  participantId: string,
  claimId: string,
  points: number,
): Promise<DiscoveryResult<{ state: DiscoveryClaimState; points: number; transaction?: string }>> {
  if (points === 0) {
    await query(`update score_discovery_claims set state = 'accepted' where id = $1`, [claimId]);
    return { ok: true, value: { state: "accepted", points: 0 } };
  }
  const scored = await recordScore({
    eventSlug: discovery.eventSlug,
    activityId: discovery.activityId,
    sourceType: "discovery",
    sourceId: claimId,
    idempotencyKey: `discovery:${claimId}`,
    reasonCode: "discovery",
    actorType: "attendee",
    actorId: participantId,
    postings: [{ participantId, points }],
  });
  if (!scored.ok) {
    await query(`update score_discovery_claims set state = 'rejected' where id = $1`, [claimId]);
    return scored;
  }
  const state = scored.value.status === "held" ? "held" : "accepted";
  await query(`update score_discovery_claims set state = $2, transaction_id = $3 where id = $1`, [
    claimId,
    state,
    scored.value.id,
  ]);
  return { ok: true, value: { state, points, transaction: scored.value.id } };
}
