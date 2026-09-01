import { createHash, createHmac, randomUUID } from "node:crypto";

import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import { getEvent } from "@/features/events/store.server";
import { isCapabilityEffective } from "@/features/attendee-operations/capabilities.server";
import { getTicket } from "@/features/tickets/store.server";
import {
  SCORE_ECONOMY,
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
  activity_id: string | null;
  name: string;
  method: string;
  status: string;
  rule: unknown;
  replacement_revision: number;
};

export type Discovery = {
  id: string;
  eventSlug: string;
  activityId?: string;
  name: string;
  method: "qr" | "code" | "word" | "phrase" | "collected-clues";
  status: DiscoveryRow["status"];
  rule: DiscoveryRule;
  replacementRevision: number;
};

export type DiscoveryClueSetup = {
  key: string;
  label: string;
  claimToken: string;
  replacementRevision: number;
};

export type DiscoverySetup = Discovery & {
  claimToken?: string;
  code?: string;
  clues?: DiscoveryClueSetup[];
};

export type DiscoveryClaimProgress = { claimed: number; total: number; complete: boolean };
export type DiscoveryClue = Omit<DiscoveryClueSetup, "claimToken">;
export type DiscoveryClaimValue = {
  state: DiscoveryClaimState;
  points: number;
  transaction?: string;
  progress?: DiscoveryClaimProgress;
  nextEligibleAt?: string;
  retryAfterSeconds?: number;
};

export type DiscoveryResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      status: number;
      error: string;
      retryAt?: string;
      retryAfterSeconds?: number;
    };

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function discoveryRuleError(rule: DiscoveryRule, method: Discovery["method"]): string | null {
  const perClaimMaximum = Math.max(
    0,
    rule.pointsPerClue ?? 0,
    rule.completionBonus ?? 0,
    rule.pointMode === "per-clue-plus-completion"
      ? (rule.pointsPerClue ?? 0) + (rule.completionBonus ?? 0)
      : 0,
    ...(rule.tiers ?? []),
  );
  if (!Number.isInteger(perClaimMaximum) || perClaimMaximum > SCORE_ECONOMY.maximumSingleAward) {
    return `One discovery claim cannot award more than ${SCORE_ECONOMY.maximumSingleAward} points per person`;
  }
  if (rule.claimFrequency === "once") return null;
  if (method === "collected-clues") return "Collected hunts can only be claimed once per clue";
  if (
    !Number.isInteger(rule.cooldownSeconds) ||
    rule.cooldownSeconds < 1 ||
    rule.cooldownSeconds > 7 * 24 * 60 * 60
  ) {
    return "Cooldown must be between 1 second and 7 days";
  }
  if (
    rule.maximumClaimsPerParticipant !== undefined &&
    (!Number.isInteger(rule.maximumClaimsPerParticipant) ||
      rule.maximumClaimsPerParticipant < 1 ||
      rule.maximumClaimsPerParticipant > 10_000)
  ) {
    return "Maximum claims per person must be between 1 and 10,000";
  }
  return null;
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

export function discoveryClueCredential(input: {
  discoveryId: string;
  clueKey: string;
  revision: number;
}): string {
  const payload = `${input.discoveryId}:clue:${input.clueKey}:${input.revision}`;
  return `clue_${createHmac("sha256", credentialKey()).update(payload).digest("base64url")}`;
}

function toDiscovery(row: DiscoveryRow): Discovery {
  return {
    id: row.id,
    eventSlug: row.event_slug,
    activityId: row.activity_id ?? undefined,
    name: row.name,
    method: row.method as Discovery["method"],
    status: row.status,
    rule: row.rule as DiscoveryRule,
    replacementRevision: row.replacement_revision,
  };
}

export async function createDiscovery(input: {
  eventSlug: string;
  activityId?: string;
  name: string;
  method: Discovery["method"];
  status?: DiscoveryRow["status"];
  rule: DiscoveryRule;
  includeSecret?: boolean;
  clues?: Array<{ key: string; label: string }>;
}): Promise<DiscoveryResult<DiscoverySetup>> {
  const event = await getEvent(input.eventSlug);
  if (!event) return { ok: false, status: 404, error: "Event not found" };
  if (input.activityId) {
    const activity = await getActivity(input.activityId);
    if (!activity || activity.eventSlug !== input.eventSlug)
      return { ok: false, status: 404, error: "Activity not found" };
  }
  if (!input.name.trim()) return { ok: false, status: 400, error: "Name the discovery" };
  const ruleError = discoveryRuleError(input.rule, input.method);
  if (ruleError) return { ok: false, status: 400, error: ruleError };
  const clues = (input.clues ?? []).map((clue) => ({
    key: normalizeDiscoveryCode(clue.key).replaceAll(" ", "-").toLocaleLowerCase("en-GB"),
    label: clue.label.trim(),
  }));
  if (
    input.method === "collected-clues" &&
    (clues.length < 2 ||
      clues.length > 100 ||
      clues.some(
        (clue) => !/^[a-z0-9-]{1,80}$/.test(clue.key) || !clue.label || clue.label.length > 160,
      ) ||
      new Set(clues.map((clue) => clue.key)).size !== clues.length)
  ) {
    return { ok: false, status: 400, error: "A collected hunt needs 2 to 100 unique clues" };
  }
  if (input.method !== "collected-clues" && clues.length > 0) {
    return { ok: false, status: 400, error: "Only a collected hunt can contain several clues" };
  }
  const discoveryId = id("disc");
  const secret =
    input.method === "qr"
      ? discoveryCredential({ discoveryId, method: input.method, revision: 1 })
      : null;
  const code =
    input.method === "code" || input.method === "word" || input.method === "phrase"
      ? discoveryCredential({ discoveryId, method: input.method, revision: 1 })
      : null;
  const clueSetups = clues.map((clue) => ({
    ...clue,
    claimToken: discoveryClueCredential({
      discoveryId,
      clueKey: clue.key,
      revision: 1,
    }),
    replacementRevision: 1,
  }));
  const row = await transaction(async (client) => {
    const inserted = await client.query<DiscoveryRow>(
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
    for (const clue of clueSetups) {
      await client.query(
        `insert into score_discovery_clues
           (id, discovery_id, clue_key, label, token_hash)
         values ($1,$2,$3,$4,$5)`,
        [id("dclue"), discoveryId, clue.key, clue.label, digest(clue.claimToken)],
      );
    }
    return inserted.rows[0] ?? null;
  });
  if (!row) return { ok: false, status: 500, error: "Discovery could not be created" };
  return {
    ok: true,
    value: {
      ...toDiscovery(row),
      claimToken: input.includeSecret === false ? undefined : (secret ?? undefined),
      code: input.includeSecret === false ? undefined : (code ?? undefined),
      clues: input.includeSecret === false ? undefined : clueSetups,
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

export async function listDiscoveryClues(discoveryId: string): Promise<DiscoveryClue[]> {
  const rows = await query<{
    clue_key: string;
    label: string;
    replacement_revision: number;
  }>(
    `select clue_key, label, replacement_revision
       from score_discovery_clues where discovery_id = $1 order by created_at, clue_key`,
    [discoveryId],
  );
  return rows.map((row) => ({
    key: row.clue_key,
    label: row.label,
    replacementRevision: row.replacement_revision,
  }));
}

export async function testDiscoveryCredential(input: {
  discoveryId: string;
  presented: string;
}): Promise<
  DiscoveryResult<{ matched: boolean; clueKey?: string; liveState: Discovery["status"] }>
> {
  const discovery = await getDiscovery(input.discoveryId);
  if (!discovery) return { ok: false, status: 404, error: "Discovery not found" };
  const resolved = await resolveDiscovery(discovery, input.presented);
  return {
    ok: true,
    value: {
      matched: resolved.matched,
      clueKey: resolved.clueKey ?? undefined,
      liveState: discovery.status,
    },
  };
}

const DISCOVERY_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["scheduled", "live", "cancelled"],
  scheduled: ["live", "paused", "cancelled"],
  live: ["paused", "exhausted", "ended", "cancelled"],
  paused: ["live", "ended", "cancelled"],
  exhausted: ["ended"],
  ended: [],
  cancelled: [],
};

export async function updateDiscovery(input: {
  eventSlug: string;
  discoveryId: string;
  actorId: string;
  name?: string;
  status?: Discovery["status"];
  rule?: DiscoveryRule;
  reopen?: boolean;
  reason?: string;
}): Promise<DiscoveryResult<Discovery>> {
  const current = await getDiscovery(input.discoveryId);
  if (!current || current.eventSlug !== input.eventSlug) {
    return { ok: false, status: 404, error: "Discovery not found" };
  }
  if (input.name !== undefined && !input.name.trim()) {
    return { ok: false, status: 400, error: "Name the discovery" };
  }
  if (input.status && input.status !== current.status) {
    const reopening =
      input.reopen === true &&
      (current.status === "ended" || current.status === "cancelled") &&
      input.status === "draft";
    if (reopening && !input.reason?.trim()) {
      return { ok: false, status: 400, error: "Reopening a discovery needs a reason" };
    }
    if (!reopening && !(DISCOVERY_TRANSITIONS[current.status] ?? []).includes(input.status)) {
      return {
        ok: false,
        status: 409,
        error: `Cannot move a discovery from ${current.status} to ${input.status}`,
      };
    }
  }
  if ((current.status === "ended" || current.status === "cancelled") && input.rule) {
    return { ok: false, status: 409, error: "Closed discovery rules cannot be changed" };
  }
  if (input.rule) {
    const ruleError = discoveryRuleError(input.rule, current.method);
    if (ruleError) return { ok: false, status: 400, error: ruleError };
  }
  const row = await queryOne<DiscoveryRow>(
    `update score_discoveries set
       name = coalesce($3, name), status = coalesce($4, status),
       rule = coalesce($5::jsonb, rule), updated_at = now()
     where id = $1 and event_slug = $2
     returning id, event_slug, activity_id, name, method, status, rule, replacement_revision`,
    [
      input.discoveryId,
      input.eventSlug,
      input.name?.trim() ?? null,
      input.status ?? null,
      input.rule ? JSON.stringify(input.rule) : null,
    ],
  );
  if (!row) return { ok: false, status: 404, error: "Discovery not found" };
  await query(
    `insert into score_audit_events
       (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
     values ($1,'discovery.updated','admin',$2,'discovery',$3,$4::jsonb)`,
    [
      input.eventSlug,
      input.actorId,
      input.discoveryId,
      JSON.stringify({
        fromStatus: current.status,
        toStatus: row.status,
        reason: input.reason ?? null,
      }),
    ],
  );
  return { ok: true, value: toDiscovery(row) };
}

export async function copyDiscovery(input: {
  eventSlug: string;
  discoveryId: string;
  actorId: string;
  name?: string;
}): Promise<DiscoveryResult<DiscoverySetup>> {
  const current = await getDiscovery(input.discoveryId);
  if (!current || current.eventSlug !== input.eventSlug) {
    return { ok: false, status: 404, error: "Discovery not found" };
  }
  const created = await createDiscovery({
    eventSlug: input.eventSlug,
    activityId: current.activityId,
    name: input.name?.trim() || `${current.name} copy`,
    method: current.method,
    status: "draft",
    rule: current.rule,
    clues:
      current.method === "collected-clues"
        ? (await listDiscoveryClues(current.id)).map((clue) => ({
            key: clue.key,
            label: clue.label,
          }))
        : undefined,
    includeSecret: true,
  });
  if (!created.ok) return created;
  await query(
    `insert into score_audit_events
       (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
     values ($1,'discovery.copied','admin',$2,'discovery',$3,$4::jsonb)`,
    [input.eventSlug, input.actorId, created.value.id, JSON.stringify({ sourceId: current.id })],
  );
  return created;
}

export async function replaceDiscoveryClueSecret(input: {
  eventSlug: string;
  discoveryId: string;
  clueKey: string;
  actorId: string;
}): Promise<DiscoveryResult<{ claimToken: string; replacementRevision: number }>> {
  const current = await queryOne<{
    event_slug: string;
    replacement_revision: number;
  }>(
    `select discoveries.event_slug, clues.replacement_revision
       from score_discovery_clues clues
       join score_discoveries discoveries on discoveries.id = clues.discovery_id
      where clues.discovery_id = $1 and clues.clue_key = $2 and discoveries.event_slug = $3`,
    [input.discoveryId, input.clueKey, input.eventSlug],
  );
  if (!current) return { ok: false, status: 404, error: "Discovery clue not found" };
  const replacementRevision = current.replacement_revision + 1;
  const claimToken = discoveryClueCredential({
    discoveryId: input.discoveryId,
    clueKey: input.clueKey,
    revision: replacementRevision,
  });
  await transaction(async (client) => {
    await client.query(
      `update score_discovery_clues
          set token_hash = $3, replacement_revision = $4, updated_at = now()
        where discovery_id = $1 and clue_key = $2`,
      [input.discoveryId, input.clueKey, digest(claimToken), replacementRevision],
    );
    await client.query(
      `insert into score_audit_events
         (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
       values ($1,'discovery.clue.replaced','admin',$2,'discovery',$3,$4::jsonb)`,
      [
        current.event_slug,
        input.actorId,
        input.discoveryId,
        JSON.stringify({ clueKey: input.clueKey, revision: replacementRevision }),
      ],
    );
  });
  return { ok: true, value: { claimToken, replacementRevision } };
}

export async function replaceDiscoverySecret(input: {
  eventSlug: string;
  discoveryId: string;
  actorId: string;
}): Promise<DiscoveryResult<{ claimToken: string; replacementRevision: number }>> {
  const current = await queryOne<{
    event_slug: string;
    method: Discovery["method"];
    replacement_revision: number;
  }>(
    `select event_slug, method, replacement_revision
       from score_discoveries where id = $1 and event_slug = $2`,
    [input.discoveryId, input.eventSlug],
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

async function resolveDiscovery(
  discovery: Discovery,
  value: string,
): Promise<{ matched: boolean; clueKey: string | null }> {
  if (discovery.method === "qr") {
    const row = await queryOne<{ id: string }>(
      `select id from score_discoveries where id = $1 and token_hash = $2`,
      [discovery.id, digest(value)],
    );
    return { matched: Boolean(row), clueKey: null };
  }
  if (discovery.method === "collected-clues") {
    const row = await queryOne<{ clue_key: string }>(
      `select clue_key from score_discovery_clues
        where discovery_id = $1 and token_hash = $2`,
      [discovery.id, digest(value)],
    );
    return { matched: Boolean(row), clueKey: row?.clue_key ?? null };
  }
  const row = await queryOne<{ id: string }>(
    `select id from score_discoveries where id = $1 and code_hash = $2`,
    [discovery.id, digest(normalizeDiscoveryCode(value))],
  );
  return { matched: Boolean(row), clueKey: null };
}

export async function findDiscoveryForPresented(
  eventSlug: string,
  presented: string,
): Promise<Discovery | null> {
  if (!(await isCapabilityEffective(eventSlug, "discoveries"))) return null;
  const rawHash = digest(presented);
  const normalizedHash = digest(normalizeDiscoveryCode(presented));
  const row = await queryOne<{ id: string }>(
    `select discoveries.id
       from score_discoveries discoveries
      where discoveries.event_slug = $1
        and discoveries.status = 'live'
        and (discoveries.token_hash = $2 or discoveries.code_hash = $3)
      union all
     select discoveries.id
       from score_discovery_clues clues
       join score_discoveries discoveries on discoveries.id = clues.discovery_id
      where discoveries.event_slug = $1
        and discoveries.status = 'live'
        and clues.token_hash = $2
      limit 1`,
    [eventSlug, rawHash, normalizedHash],
  );
  return row ? getDiscovery(row.id) : null;
}

export async function claimDiscovery(input: {
  discoveryId: string;
  participantId: string;
  presented: string;
  commandId: string;
}): Promise<DiscoveryResult<DiscoveryClaimValue>> {
  const discovery = await getDiscovery(input.discoveryId);
  if (!discovery) return { ok: false, status: 404, error: "Discovery not found" };
  if (!(await isCapabilityEffective(discovery.eventSlug, "discoveries"))) {
    return { ok: false, status: 409, error: "Discoveries are paused for this event" };
  }
  if (
    discovery.rule.pointMode !== "none" &&
    !(await isCapabilityEffective(discovery.eventSlug, "scoring"))
  ) {
    return { ok: false, status: 409, error: "Scoring is paused for this event" };
  }
  const [participant, event] = await Promise.all([
    getParticipant(input.participantId),
    getEvent(discovery.eventSlug),
  ]);
  if (!participant || participant.eventSlug !== discovery.eventSlug)
    return { ok: false, status: 404, error: "Participant not found" };
  if (!event || event.status === "cancelled" || event.status === "archived") {
    return { ok: false, status: 409, error: "This event is not accepting discovery claims" };
  }
  if (discovery.status !== "live")
    return { ok: false, status: 409, error: "This discovery is not live" };
  const pendingTransfer = await queryOne<{ pending: boolean }>(
    `select true as pending
       from event_participants participants
       join ticket_transfers transfers on transfers.ticket_id = participants.ticket_id
      where participants.id = $1 and transfers.status = 'pending'`,
    [input.participantId],
  );
  if (pendingTransfer) {
    return { ok: false, status: 409, error: "Ticket transfer is pending; clues are paused" };
  }
  const resolved = await resolveDiscovery(discovery, input.presented);
  if (!resolved.matched) return { ok: false, status: 400, error: "That clue does not match" };
  const clueKey = resolved.clueKey;
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

  const settings =
    discovery.rule.pointMode === "none" ? null : await getOrCreateSettings(discovery.eventSlug);
  if (settings && settings.state !== "live" && settings.state !== "frozen") {
    return { ok: false, status: 409, error: "Scoring is not accepting discovery claims" };
  }
  const claimId = id("claim");
  type ExistingClaim = {
    id: string;
    state: DiscoveryClaimState;
    points: number;
    transaction_id: string | null;
    created_at: Date;
  };
  type ClaimReservation =
    | { kind: "duplicate"; claim: ExistingClaim }
    | { kind: "cooldown"; retryAt: Date; retryAfterSeconds: number }
    | { kind: "participant-limit" }
    | { kind: "pool-limit" }
    | { kind: "processing" }
    | {
        kind: "reserved";
        claimId: string;
        points: number;
        progress?: DiscoveryClaimProgress;
        createdAt: Date;
      };
  const claim: ClaimReservation = await transaction(async (client) => {
    // Claim numbers must be allocated under one lock. Without this, two final
    // claims can both receive the same diminishing tier, bypass a cooldown, or exhaust a pool.
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [input.discoveryId]);
    const commandClaim = await client.query<ExistingClaim>(
      `select id, state, points, transaction_id, created_at
         from score_discovery_claims
        where discovery_id = $1 and command_id = $2`,
      [input.discoveryId, input.commandId],
    );
    if (commandClaim.rows[0]) return { kind: "duplicate", claim: commandClaim.rows[0] };

    if (discovery.rule.claimFrequency === "once") {
      const priorClaim = await client.query<ExistingClaim>(
        `select id, state, points, transaction_id, created_at
           from score_discovery_claims
          where discovery_id = $1 and participant_id = $2
            and clue_key is not distinct from $3 and state in ('accepted', 'held')
          order by created_at desc, id desc
          limit 1`,
        [input.discoveryId, input.participantId, clueKey],
      );
      if (priorClaim.rows[0]) return { kind: "duplicate", claim: priorClaim.rows[0] };
    } else {
      const participantClaims = await client.query<{ count: string }>(
        `select count(*)::text as count
           from score_discovery_claims
          where discovery_id = $1 and participant_id = $2
            and state in ('accepted', 'held')`,
        [input.discoveryId, input.participantId],
      );
      const participantClaimCount = Number(participantClaims.rows[0]?.count ?? 0);
      if (
        discovery.rule.maximumClaimsPerParticipant !== undefined &&
        participantClaimCount >= discovery.rule.maximumClaimsPerParticipant
      ) {
        return { kind: "participant-limit" };
      }
      const latestClaim = await client.query<{
        retry_at: Date;
        retry_after_seconds: number;
      }>(
        `select created_at + ($3::integer * interval '1 second') as retry_at,
                greatest(0, ceil(extract(epoch from
                  (created_at + ($3::integer * interval '1 second') - clock_timestamp())
                )))::integer as retry_after_seconds
           from score_discovery_claims
          where discovery_id = $1 and participant_id = $2
            and state in ('accepted', 'held')
          order by created_at desc, id desc
          limit 1`,
        [input.discoveryId, input.participantId, discovery.rule.cooldownSeconds],
      );
      const latest = latestClaim.rows[0];
      if (latest && latest.retry_after_seconds > 0) {
        return {
          kind: "cooldown",
          retryAt: latest.retry_at,
          retryAfterSeconds: latest.retry_after_seconds,
        };
      }
    }
    const clueTotals =
      discovery.method === "collected-clues"
        ? await client.query<{ total: string; claimed: string }>(
            `select
               (select count(*)::text from score_discovery_clues where discovery_id = $1) as total,
               (select count(*)::text from score_discovery_claims
                 where discovery_id = $1 and participant_id = $2 and clue_key is not null
                   and state in ('accepted', 'held')) as claimed`,
            [input.discoveryId, input.participantId],
          )
        : null;
    const totalClues = Number(clueTotals?.rows[0]?.total ?? 0);
    const claimedBefore = Number(clueTotals?.rows[0]?.claimed ?? 0);
    const progress =
      discovery.method === "collected-clues"
        ? {
            claimed: claimedBefore + 1,
            total: totalClues,
            complete: totalClues > 0 && claimedBefore + 1 === totalClues,
          }
        : undefined;
    const claimNumberRows = await client.query<{ count: string }>(
      `select count(*)::text as count
         from score_discovery_claims
        where discovery_id = $1 and state in ('accepted', 'held')`,
      [input.discoveryId],
    );
    const claimNumber = Number(claimNumberRows.rows[0]?.count ?? 0) + 1;
    if (
      (discovery.rule.claimantLimit !== undefined &&
        claimNumber > Math.max(0, Math.trunc(discovery.rule.claimantLimit))) ||
      (discovery.rule.pointMode === "one-winner" && claimNumber > 1)
    ) {
      return { kind: "pool-limit" };
    }
    const claimedPoints = await client.query<{ total: string }>(
      `select coalesce(sum(points), 0)::text as total
         from score_discovery_claims
        where discovery_id = $1 and state in ('accepted', 'held')`,
      [input.discoveryId],
    );
    let points = discoveryClaimPoints(discovery.rule, claimNumber, progress?.complete ?? false);
    if (discovery.rule.pointMode === "fixed-pool" && discovery.rule.poolPoints !== undefined) {
      const remaining = Math.max(
        0,
        Math.trunc(discovery.rule.poolPoints) - Number(claimedPoints.rows[0]?.total ?? 0),
      );
      if (remaining < points) {
        if (discovery.rule.remainderAward === "discard") return { kind: "pool-limit" };
        points = remaining;
      }
    }
    if (points <= 0 && discovery.rule.pointMode === "fixed-pool") {
      return { kind: "pool-limit" };
    }
    const inserted = await client.query<{ id: string; created_at: Date }>(
      `insert into score_discovery_claims
         (id, discovery_id, event_slug, participant_id, command_id, state, points, clue_key)
       values ($1,$2,$3,$4,$5,'held',$6,$7)
       on conflict do nothing
       returning id, created_at`,
      [
        claimId,
        input.discoveryId,
        discovery.eventSlug,
        input.participantId,
        input.commandId,
        points,
        clueKey,
      ],
    );
    if (!inserted.rows[0]) {
      const duplicate = await client.query<ExistingClaim>(
        `select id, state, points, transaction_id, created_at
           from score_discovery_claims
          where discovery_id = $1
            and (command_id = $2 or
              (participant_id = $3 and clue_key is not distinct from $4))
          order by (command_id = $2) desc, created_at desc
          limit 1`,
        [input.discoveryId, input.commandId, input.participantId, clueKey],
      );
      return duplicate.rows[0]
        ? { kind: "duplicate", claim: duplicate.rows[0] }
        : { kind: "processing" };
    }
    return {
      kind: "reserved",
      claimId,
      points,
      progress,
      createdAt: inserted.rows[0].created_at,
    };
  });
  if (claim.kind === "pool-limit") {
    return { ok: false, status: 409, error: "This discovery has no claimant points left" };
  }
  if (claim.kind === "participant-limit") {
    return { ok: false, status: 409, error: "You have reached this discovery's claim limit" };
  }
  if (claim.kind === "cooldown") {
    return {
      ok: false,
      status: 429,
      error: "This discovery is cooling down",
      retryAt: claim.retryAt.toISOString(),
      retryAfterSeconds: claim.retryAfterSeconds,
    };
  }
  if (claim.kind === "duplicate") {
    const cooldown = cooldownResult(discovery.rule, claim.claim.created_at);
    if (claim.claim.state === "held" && !claim.claim.transaction_id) {
      if (settings && settings.state !== "live") {
        return { ok: true, value: { state: "held", points: claim.claim.points, ...cooldown } };
      }
      return settleDiscoveryClaim(
        discovery,
        input.participantId,
        claim.claim.id,
        claim.claim.points,
        undefined,
        cooldown,
      );
    }
    return {
      ok: true,
      value: {
        state: claim.claim.state,
        points: claim.claim.points,
        transaction: claim.claim.transaction_id ?? undefined,
        ...cooldown,
      },
    };
  }
  if (claim.kind === "processing") {
    return { ok: false, status: 409, error: "This claim is already being processed" };
  }
  const cooldown = cooldownResult(discovery.rule, claim.createdAt);
  const points = claim.points;
  if (settings && settings.state !== "live") {
    await query(`update score_discovery_claims set state = 'held' where id = $1`, [claimId]);
    return { ok: true, value: { state: "held", points, ...cooldown } };
  }
  return settleDiscoveryClaim(
    discovery,
    input.participantId,
    claimId,
    points,
    claim.progress,
    cooldown,
  );
}

function cooldownResult(
  rule: DiscoveryRule,
  createdAt: Date,
): Pick<DiscoveryClaimValue, "nextEligibleAt" | "retryAfterSeconds"> {
  if (rule.claimFrequency !== "cooldown") return {};
  const nextEligibleAt = createdAt.getTime() + rule.cooldownSeconds * 1000;
  return {
    nextEligibleAt: new Date(nextEligibleAt).toISOString(),
    retryAfterSeconds: Math.min(
      rule.cooldownSeconds,
      Math.max(0, Math.ceil((nextEligibleAt - Date.now()) / 1000)),
    ),
  };
}

async function settleDiscoveryClaim(
  discovery: Discovery,
  participantId: string,
  claimId: string,
  points: number,
  progress?: DiscoveryClaimProgress,
  cooldown: Pick<DiscoveryClaimValue, "nextEligibleAt" | "retryAfterSeconds"> = {},
): Promise<DiscoveryResult<DiscoveryClaimValue>> {
  if (points === 0) {
    await query(`update score_discovery_claims set state = 'accepted' where id = $1`, [claimId]);
    return { ok: true, value: { state: "accepted", points: 0, progress, ...cooldown } };
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
  return {
    ok: true,
    value: { state, points, transaction: scored.value.id, progress, ...cooldown },
  };
}
