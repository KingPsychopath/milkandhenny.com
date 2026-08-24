import { randomUUID, createHash } from "node:crypto";
import type { PoolClient } from "pg";

import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import type {
  ActivityStatus,
  ActivityTemplate,
  LeaderboardVisibility,
  ScoreActivity,
  ScoreParticipant,
  ScorePosting,
  ScoreProjection,
  ScoreRule,
  ScoreTransaction,
  ScoringSettings,
  ScoringState,
  ScoreSourceType,
  ScoreReasonCode,
  ScoreTransactionStatus,
  ScoreTeam,
  ScoreTeamMembership,
  ScoreNotification,
  ScoreAuditEvent,
  ScoreMediaLink,
  StaffAssignmentStatus,
  StaffAssignmentType,
  StaffPermissionSet,
} from "./types";

export type ScoreStoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

type ScoringSettingsRow = {
  event_slug: string;
  state: string;
  leaderboard_visibility: string;
  scheduled_start: Date | null;
  scheduled_end: Date | null;
  allow_precheckin_online_points: boolean;
  public_names: string;
  public_ranking_policy: string;
  photo_consent_policy: string;
  revision: string | number;
};

type ActivityRow = {
  id: string;
  event_slug: string;
  name: string;
  template: string;
  status: string;
  rule: unknown;
  rule_revision: number;
  starts_at: Date | null;
  ends_at: Date | null;
  pool_id?: string | null;
};

type ParticipantRow = {
  id: string;
  event_slug: string;
  person_id: string | null;
  ticket_id: string | null;
  public_alias: string;
  display_name: string | null;
  status: string;
  checked_in_at: Date | null;
  balance: number;
  projection_revision: string | number;
  last_transaction_at: Date | null;
  team_id: string | null;
  team_name: string | null;
};

type TransactionRow = {
  id: string;
  event_slug: string;
  activity_id: string | null;
  source_type: string;
  source_id: string;
  idempotency_key: string;
  status: string;
  reason_code: string;
  note: string | null;
  rule_revision: number | null;
  actor_type: string;
  actor_id: string | null;
  station_id: string | null;
  device_id: string | null;
  metadata?: unknown;
  created_at: Date;
};

type PostingRow = {
  participant_id: string;
  points: number;
  team_id: string | null;
};

type StaffAssignmentRow = {
  id: string;
  event_slug: string;
  label: string;
  assignment_type: string;
  permissions: unknown;
  scope: unknown;
  status: string;
  expires_at: Date | null;
  revoked_at: Date | null;
};

export type StoredStaffAssignment = {
  id: string;
  eventSlug: string;
  label: string;
  assignmentType: StaffAssignmentType;
  permissions: StaffPermissionSet;
  scope: Record<string, unknown>;
  status: StaffAssignmentStatus;
  expiresAt?: string;
  revokedAt?: string;
};

export type RecordScoreInput = {
  eventSlug: string;
  activityId?: string;
  sourceType: ScoreSourceType;
  sourceId: string;
  idempotencyKey: string;
  status?: ScoreTransactionStatus;
  reasonCode: ScoreReasonCode;
  note?: string;
  ruleRevision?: number;
  actorType: "system" | "admin" | "staff" | "attendee";
  actorId?: string;
  assignmentId?: string;
  stationId?: string;
  deviceId?: string;
  originalTransactionId?: string;
  metadata?: Record<string, unknown>;
  postings: ScorePosting[];
  poolId?: string;
};

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function iso(value: Date | null): string | undefined {
  return value?.toISOString();
}

function textValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function recordObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value));
  }
  return {};
}

function toSettings(row: ScoringSettingsRow): ScoringSettings {
  return {
    eventSlug: row.event_slug,
    state: textValue(row.state, "off") as ScoringState,
    leaderboardVisibility: textValue(row.leaderboard_visibility, "hidden") as LeaderboardVisibility,
    scheduledStart: iso(row.scheduled_start),
    scheduledEnd: iso(row.scheduled_end),
    allowPreCheckinOnlinePoints: row.allow_precheckin_online_points,
    publicNames: textValue(row.public_names, "generated") as ScoringSettings["publicNames"],
    publicRankingPolicy: textValue(
      row.public_ranking_policy,
      "exclude-refunded",
    ) as ScoringSettings["publicRankingPolicy"],
    photoConsentPolicy: textValue(
      row.photo_consent_policy,
      "ask",
    ) as ScoringSettings["photoConsentPolicy"],
    revision: Number(row.revision),
  };
}

function toActivity(row: ActivityRow): ScoreActivity {
  return {
    id: row.id,
    eventSlug: row.event_slug,
    name: row.name,
    template: row.template as ActivityTemplate,
    status: row.status as ActivityStatus,
    rule: recordObject(row.rule) as unknown as ScoreRule,
    ruleRevision: row.rule_revision,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    pointPoolId: row.pool_id ?? undefined,
  };
}

function toParticipant(
  row: ParticipantRow,
): ScoreParticipant & ScoreProjection & { teamId?: string } {
  return {
    id: row.id,
    participantId: row.id,
    eventSlug: row.event_slug,
    personId: row.person_id ?? undefined,
    ticketId: row.ticket_id ?? undefined,
    publicAlias: row.public_alias,
    displayName: row.display_name ?? undefined,
    status: row.status as ScoreParticipant["status"],
    checkedInAt: iso(row.checked_in_at),
    balance: row.balance,
    revision: Number(row.projection_revision),
    lastTransactionAt: iso(row.last_transaction_at),
    teamId: row.team_id ?? undefined,
    teamName: row.team_name ?? undefined,
  };
}

function toTransaction(row: TransactionRow, postings: ScorePosting[]): ScoreTransaction {
  return {
    id: row.id,
    eventSlug: row.event_slug,
    activityId: row.activity_id ?? undefined,
    sourceType: row.source_type as ScoreSourceType,
    sourceId: row.source_id,
    idempotencyKey: row.idempotency_key,
    status: row.status as ScoreTransactionStatus,
    reasonCode: row.reason_code as ScoreReasonCode,
    note: row.note ?? undefined,
    ruleRevision: row.rule_revision ?? undefined,
    actorType: row.actor_type as ScoreTransaction["actorType"],
    actorId: row.actor_id ?? undefined,
    stationId: row.station_id ?? undefined,
    deviceId: row.device_id ?? undefined,
    metadata: recordObject(row.metadata),
    createdAt: row.created_at.toISOString(),
    postings,
  };
}

export function hashStaffToken(token: string): string {
  return hash(token);
}

export async function findSettings(eventSlug: string): Promise<ScoringSettings | null> {
  const row = await queryOne<ScoringSettingsRow>(
    `select * from event_scoring_settings where event_slug = $1`,
    [eventSlug],
  );
  return row ? toSettings(row) : null;
}

export async function getOrCreateSettings(eventSlug: string): Promise<ScoringSettings> {
  await query(
    `insert into event_scoring_settings (event_slug) values ($1) on conflict (event_slug) do nothing`,
    [eventSlug],
  );
  const row = await queryOne<ScoringSettingsRow>(
    `select * from event_scoring_settings where event_slug = $1`,
    [eventSlug],
  );
  if (!row) throw new Error("Event scoring settings could not be created");
  return toSettings(row);
}

export async function updateSettings(
  eventSlug: string,
  changes: Partial<
    Pick<
      ScoringSettings,
      | "state"
      | "leaderboardVisibility"
      | "scheduledStart"
      | "scheduledEnd"
      | "allowPreCheckinOnlinePoints"
      | "publicNames"
      | "publicRankingPolicy"
      | "photoConsentPolicy"
    >
  >,
): Promise<ScoringSettings> {
  const row = await queryOne<ScoringSettingsRow>(
    `update event_scoring_settings
        set state = coalesce($2, state),
            leaderboard_visibility = coalesce($3, leaderboard_visibility),
            scheduled_start = coalesce($4::timestamptz, scheduled_start),
            scheduled_end = coalesce($5::timestamptz, scheduled_end),
            allow_precheckin_online_points = coalesce($6, allow_precheckin_online_points),
            public_names = coalesce($7, public_names),
            public_ranking_policy = coalesce($8, public_ranking_policy),
            photo_consent_policy = coalesce($9, photo_consent_policy),
            revision = revision + 1,
            updated_at = now()
      where event_slug = $1
      returning *`,
    [
      eventSlug,
      changes.state ?? null,
      changes.leaderboardVisibility ?? null,
      changes.scheduledStart ?? null,
      changes.scheduledEnd ?? null,
      changes.allowPreCheckinOnlinePoints ?? null,
      changes.publicNames ?? null,
      changes.publicRankingPolicy ?? null,
      changes.photoConsentPolicy ?? null,
    ],
  );
  if (!row) throw new Error("Event scoring settings not found");
  return toSettings(row);
}

export async function createActivity(input: {
  eventSlug: string;
  name: string;
  template: ActivityTemplate;
  rule: ScoreRule;
  status?: ActivityStatus;
  startsAt?: string;
  endsAt?: string;
  createdBy?: string;
}): Promise<ScoreActivity> {
  const activityId = id("act");
  const row = await queryOne<ActivityRow>(
    `insert into score_activities
       (id, event_slug, name, template, status, rule, starts_at, ends_at, created_by)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
     returning *, null::text as pool_id`,
    [
      activityId,
      input.eventSlug,
      input.name.trim(),
      input.template,
      input.status ?? "draft",
      JSON.stringify(input.rule),
      input.startsAt ?? null,
      input.endsAt ?? null,
      input.createdBy ?? null,
    ],
  );
  if (!row) throw new Error("Activity could not be created");
  return toActivity(row);
}

export async function getActivity(activityId: string): Promise<ScoreActivity | null> {
  const row = await queryOne<ActivityRow>(
    `select a.*, p.id as pool_id
       from score_activities a
       left join score_pools p on p.activity_id = a.id
      where a.id = $1`,
    [activityId],
  );
  return row ? toActivity(row) : null;
}

export async function updateActivity(
  activityId: string,
  changes: Partial<Pick<ScoreActivity, "name" | "status" | "startsAt" | "endsAt">> & {
    rule?: ScoreRule;
  },
): Promise<ScoreActivity | null> {
  const row = await queryOne<ActivityRow>(
    `update score_activities
        set name = coalesce($2, name),
            status = coalesce($3, status),
            starts_at = coalesce($4::timestamptz, starts_at),
            ends_at = coalesce($5::timestamptz, ends_at),
            rule = coalesce($6::jsonb, rule),
            rule_revision = case when $6 is null then rule_revision else rule_revision + 1 end,
            updated_at = now()
      where id = $1
      returning *, null::text as pool_id`,
    [
      activityId,
      changes.name ?? null,
      changes.status ?? null,
      changes.startsAt ?? null,
      changes.endsAt ?? null,
      changes.rule ? JSON.stringify(changes.rule) : null,
    ],
  );
  return row ? toActivity(row) : null;
}

export async function listActivities(eventSlug: string): Promise<ScoreActivity[]> {
  const rows = await query<ActivityRow>(
    `select a.*, p.id as pool_id
       from score_activities a
       left join score_pools p on p.activity_id = a.id
      where a.event_slug = $1
      order by a.created_at desc, a.id`,
    [eventSlug],
  );
  return rows.map(toActivity);
}

export async function createTeam(input: {
  eventSlug: string;
  name: string;
}): Promise<ScoreStoreResult<ScoreTeam>> {
  if (!input.name.trim()) return { ok: false, status: 400, error: "Name the team" };
  const row = await queryOne<{ id: string; event_slug: string; name: string; status: string }>(
    `insert into score_teams (id, event_slug, name)
     values ($1,$2,$3)
     returning id, event_slug, name, status`,
    [id("team"), input.eventSlug, input.name.trim()],
  );
  if (!row) return { ok: false, status: 500, error: "Team could not be created" };
  return {
    ok: true,
    value: {
      id: row.id,
      eventSlug: row.event_slug,
      name: row.name,
      status: row.status as ScoreTeam["status"],
    },
  };
}

export async function listTeams(eventSlug: string): Promise<ScoreTeam[]> {
  const rows = await query<{ id: string; event_slug: string; name: string; status: string }>(
    `select id, event_slug, name, status from score_teams where event_slug = $1 order by name, id`,
    [eventSlug],
  );
  return rows.map((row) => ({
    id: row.id,
    eventSlug: row.event_slug,
    name: row.name,
    status: row.status as ScoreTeam["status"],
  }));
}

export async function setTeamMembership(input: {
  eventSlug: string;
  teamId: string;
  participantId: string;
  startsAt?: string;
}): Promise<ScoreStoreResult<ScoreTeamMembership>> {
  try {
    return await transaction(async (client) => {
      const participant = await client.query<{ id: string }>(
        `select id from event_participants where id = $1 and event_slug = $2 for update`,
        [input.participantId, input.eventSlug],
      );
      const team = await client.query<{ id: string }>(
        `select id from score_teams where id = $1 and event_slug = $2 for update`,
        [input.teamId, input.eventSlug],
      );
      if (!participant.rows[0] || !team.rows[0])
        return { ok: false, status: 404, error: "Team or participant not found" };
      const startsAt = input.startsAt ?? new Date().toISOString();
      await client.query(
        `update score_team_memberships
            set ends_at = $3
          where event_slug = $1 and participant_id = $2 and ends_at is null and starts_at < $3`,
        [input.eventSlug, input.participantId, startsAt],
      );
      const row = await client.query<{
        id: string;
        event_slug: string;
        team_id: string;
        participant_id: string;
        starts_at: Date;
        ends_at: Date | null;
      }>(
        `insert into score_team_memberships (id, event_slug, team_id, participant_id, starts_at)
         values ($1,$2,$3,$4,$5)
         returning id, event_slug, team_id, participant_id, starts_at, ends_at`,
        [id("tm"), input.eventSlug, input.teamId, input.participantId, startsAt],
      );
      const membership = row.rows[0];
      if (!membership)
        return { ok: false, status: 500, error: "Team membership could not be created" };
      return {
        ok: true,
        value: {
          id: membership.id,
          eventSlug: membership.event_slug,
          teamId: membership.team_id,
          participantId: membership.participant_id,
          startsAt: membership.starts_at.toISOString(),
          endsAt: membership.ends_at?.toISOString(),
        },
      };
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("score_team_memberships")) {
      return { ok: false, status: 409, error: "That team membership overlaps an existing period" };
    }
    throw error;
  }
}

export async function privateOrderScore(input: {
  eventSlug: string;
  orderId: string;
}): Promise<
  ScoreStoreResult<{ points: number; participants: { participantId: string; points: number }[] }>
> {
  const rows = await query<{ participant_id: string; points: string }>(
    `select p.id as participant_id, coalesce(sum(case when t.status = 'accepted' then sp.points else 0 end), 0)::text as points
       from tickets tk
       join event_participants p on p.ticket_id = tk.id
       left join score_postings sp on sp.participant_id = p.id
       left join score_transactions t on t.id = sp.transaction_id
      where tk.event_slug = $1 and tk.order_id = $2
      group by p.id
      order by p.id`,
    [input.eventSlug, input.orderId],
  );
  return {
    ok: true,
    value: {
      points: rows.reduce((sum, row) => sum + Number(row.points), 0),
      participants: rows.map((row) => ({
        participantId: row.participant_id,
        points: Number(row.points),
      })),
    },
  };
}

export async function participantForTicket(
  ticketId: string,
): Promise<(ScoreParticipant & ScoreProjection & { teamId?: string }) | null> {
  const row = await queryOne<ParticipantRow>(
    `select p.*, coalesce(sp.balance, 0)::integer as balance,
            coalesce(sp.revision, 0)::bigint as projection_revision,
            sp.last_transaction_at,
            tm.team_id
       from event_participants p
       left join score_projections sp on sp.participant_id = p.id
       left join lateral (
         select m.team_id, t.name as team_name
           from score_team_memberships m
           left join score_teams t on t.id = m.team_id
          where m.participant_id = p.id
            and m.starts_at <= now()
            and (m.ends_at is null or m.ends_at > now())
          order by m.starts_at desc limit 1
       ) tm on true
      where p.ticket_id = $1`,
    [ticketId],
  );
  return row ? toParticipant(row) : null;
}

export async function getParticipant(
  participantId: string,
): Promise<(ScoreParticipant & ScoreProjection & { teamId?: string }) | null> {
  const row = await queryOne<ParticipantRow>(
    `select p.*, coalesce(sp.balance, 0)::integer as balance,
            coalesce(sp.revision, 0)::bigint as projection_revision,
            sp.last_transaction_at,
            tm.team_id
       from event_participants p
       left join score_projections sp on sp.participant_id = p.id
       left join lateral (
         select m.team_id, t.name as team_name
           from score_team_memberships m
           left join score_teams t on t.id = m.team_id
          where m.participant_id = p.id
            and m.starts_at <= now()
            and (m.ends_at is null or m.ends_at > now())
          order by m.starts_at desc limit 1
       ) tm on true
      where p.id = $1`,
    [participantId],
  );
  return row ? toParticipant(row) : null;
}

export async function listLeaderboardParticipants(
  eventSlug: string,
): Promise<(ScoreParticipant & ScoreProjection & { teamId?: string })[]> {
  const rows = await query<ParticipantRow>(
    `select p.*, coalesce(sp.balance, 0)::integer as balance,
            coalesce(sp.revision, 0)::bigint as projection_revision,
            sp.last_transaction_at,
            tm.team_id
       from event_participants p
       left join score_projections sp on sp.participant_id = p.id
       left join lateral (
         select m.team_id, t.name as team_name
           from score_team_memberships m
           left join score_teams t on t.id = m.team_id
          where m.participant_id = p.id
            and m.starts_at <= now()
            and (m.ends_at is null or m.ends_at > now())
          order by m.starts_at desc limit 1
       ) tm on true
      where p.event_slug = $1
        and p.status not in ('void', 'merged')
      order by balance desc, p.public_alias, p.id`,
    [eventSlug],
  );
  return rows.map(toParticipant);
}

export async function listTransactionsForParticipant(
  participantId: string,
  limit = 100,
): Promise<ScoreTransaction[]> {
  const rows = await query<TransactionRow>(
    `select distinct t.*
       from score_transactions t
       join score_postings p on p.transaction_id = t.id
      where p.participant_id = $1
      order by t.created_at desc, t.id desc
      limit $2`,
    [participantId, Math.min(Math.max(limit, 1), 200)],
  );
  const transactions: ScoreTransaction[] = [];
  for (const row of rows) {
    const postings = await query<PostingRow>(
      `select participant_id, points, team_id from score_postings where transaction_id = $1 order by id`,
      [row.id],
    );
    transactions.push(
      toTransaction(
        row,
        postings.map((posting) => ({
          participantId: posting.participant_id,
          points: posting.points,
          teamId: posting.team_id ?? undefined,
        })),
      ),
    );
  }
  return transactions;
}

export async function getScoreTransaction(transactionId: string): Promise<ScoreTransaction | null> {
  const row = await queryOne<TransactionRow>(`select * from score_transactions where id = $1`, [
    transactionId,
  ]);
  if (!row) return null;
  const postings = await query<PostingRow>(
    `select participant_id, points, team_id
       from score_postings
      where transaction_id = $1
      order by id`,
    [transactionId],
  );
  return toTransaction(
    row,
    postings.map((posting) => ({
      participantId: posting.participant_id,
      points: posting.points,
      teamId: posting.team_id ?? undefined,
    })),
  );
}

export async function listHeldScoreTransactions(eventSlug: string): Promise<ScoreTransaction[]> {
  const rows = await query<{ id: string }>(
    `select id from score_transactions where event_slug = $1 and status = 'held' order by created_at, id`,
    [eventSlug],
  );
  const transactions: ScoreTransaction[] = [];
  for (const row of rows) {
    const transaction = await getScoreTransaction(row.id);
    if (transaction) transactions.push(transaction);
  }
  return transactions;
}

export async function listScoreNotifications(
  participantId: string,
  options: { undeliveredOnly?: boolean; limit?: number } = {},
): Promise<ScoreNotification[]> {
  const rows = await query<{
    id: string;
    participant_id: string;
    transaction_id: string;
    kind: string;
    points: number;
    delivered_at: Date | null;
    created_at: Date;
  }>(
    `select id, participant_id, transaction_id, kind, points, delivered_at, created_at
       from score_notifications
      where participant_id = $1
        and ($2 = false or delivered_at is null)
      order by created_at, id
      limit $3`,
    [
      participantId,
      options.undeliveredOnly === true,
      Math.min(Math.max(options.limit ?? 50, 1), 100),
    ],
  );
  return rows.map((row) => ({
    id: row.id,
    participantId: row.participant_id,
    transactionId: row.transaction_id,
    kind: row.kind as ScoreNotification["kind"],
    points: row.points,
    deliveredAt: row.delivered_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
  }));
}

export async function markScoreNotificationsDelivered(notificationIds: string[]): Promise<number> {
  if (notificationIds.length === 0) return 0;
  const rows = await query<{ id: string }>(
    `update score_notifications set delivered_at = coalesce(delivered_at, now())
      where id = any($1::text[])
      returning id`,
    [notificationIds.slice(0, 100)],
  );
  return rows.length;
}

export async function listScoreAuditEvents(input: {
  eventSlug: string;
  participantId?: string;
  actorId?: string;
  activityId?: string;
  sourceId?: string;
  status?: ScoreTransactionStatus;
  limit?: number;
}): Promise<ScoreAuditEvent[]> {
  const rows = await query<{
    id: string | number;
    event_slug: string;
    action: string;
    actor_type: string;
    actor_id: string | null;
    assignment_id: string | null;
    station_id: string | null;
    device_id: string | null;
    entity_type: string;
    entity_id: string;
    metadata: unknown;
    created_at: Date;
  }>(
    `select * from score_audit_events
      where event_slug = $1
        and ($2::text is null or actor_id = $2)
        and ($3::text is null or entity_id = $3)
        and ($4::text is null or metadata->>'activityId' = $4)
        and ($5::text is null or metadata->>'sourceId' = $5)
        and ($6::text is null or metadata->>'status' = $6)
      order by created_at desc, id desc
      limit $7`,
    [
      input.eventSlug,
      input.actorId ?? null,
      input.participantId ?? null,
      input.activityId ?? null,
      input.sourceId ?? null,
      input.status ?? null,
      Math.min(Math.max(input.limit ?? 100, 1), 500),
    ],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    eventSlug: row.event_slug,
    action: row.action,
    actorType: row.actor_type,
    actorId: row.actor_id ?? undefined,
    assignmentId: row.assignment_id ?? undefined,
    stationId: row.station_id ?? undefined,
    deviceId: row.device_id ?? undefined,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: recordObject(row.metadata),
    createdAt: row.created_at.toISOString(),
  }));
}

export async function createScoreMediaLink(input: {
  eventSlug: string;
  activityId?: string;
  transactionId?: string;
  participantId?: string;
  staffActorId?: string;
  storageRef: string;
  visibility: ScoreMediaLink["visibility"];
  consentState: ScoreMediaLink["consentState"];
  expiresAt?: string;
}): Promise<ScoreStoreResult<ScoreMediaLink>> {
  if (!input.storageRef.trim())
    return { ok: false, status: 400, error: "A stored media reference is required" };
  const row = await queryOne<{
    id: string;
    event_slug: string;
    activity_id: string | null;
    transaction_id: string | null;
    participant_id: string | null;
    staff_actor_id: string | null;
    storage_ref: string;
    visibility: ScoreMediaLink["visibility"];
    consent_state: ScoreMediaLink["consentState"];
    expires_at: Date | null;
    deleted_at: Date | null;
  }>(
    `insert into score_media_links
       (id, event_slug, activity_id, transaction_id, participant_id, staff_actor_id,
        storage_ref, visibility, consent_state, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     returning *`,
    [
      id("media"),
      input.eventSlug,
      input.activityId ?? null,
      input.transactionId ?? null,
      input.participantId ?? null,
      input.staffActorId ?? null,
      input.storageRef.trim(),
      input.visibility,
      input.consentState,
      input.expiresAt ?? null,
    ],
  );
  if (!row) return { ok: false, status: 500, error: "Media link could not be saved" };
  return {
    ok: true,
    value: {
      id: row.id,
      eventSlug: row.event_slug,
      activityId: row.activity_id ?? undefined,
      transactionId: row.transaction_id ?? undefined,
      participantId: row.participant_id ?? undefined,
      staffActorId: row.staff_actor_id ?? undefined,
      storageRef: row.storage_ref,
      visibility: row.visibility,
      consentState: row.consent_state,
      expiresAt: row.expires_at?.toISOString(),
      deletedAt: row.deleted_at?.toISOString(),
    },
  };
}

export async function updateScoreMediaConsent(
  mediaId: string,
  consentState: ScoreMediaLink["consentState"],
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update score_media_links set consent_state = $2 where id = $1 and deleted_at is null returning id`,
    [mediaId, consentState],
  );
  return rows.length > 0;
}

export async function deleteScoreMediaLink(mediaId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update score_media_links set deleted_at = coalesce(deleted_at, now()) where id = $1 returning id`,
    [mediaId],
  );
  return rows.length > 0;
}

export async function rebuildEventProjections(eventSlug: string): Promise<{
  eventSlug: string;
  participants: number;
  balances: Record<string, number>;
  revision: number;
}> {
  return transaction(async (client) => {
    const settings = await lockSettings(client, eventSlug);
    const aggregates = await client.query<{
      participant_id: string;
      balance: string;
      postings: string;
    }>(
      `select participant_id, sum(points)::text as balance, count(*)::text as postings
         from score_postings p
         join score_transactions t on t.id = p.transaction_id
        where p.event_slug = $1 and t.status = 'accepted'
        group by participant_id`,
      [eventSlug],
    );
    const balances: Record<string, number> = {};
    for (const aggregate of aggregates.rows) {
      const balance = Number(aggregate.balance);
      balances[aggregate.participant_id] = Number.isFinite(balance) ? balance : 0;
    }
    await client.query(
      `insert into score_projections (participant_id, event_slug, balance, revision, last_transaction_at)
       select id, event_slug, coalesce($2::jsonb ->> id, '0')::integer, $3, now()
         from event_participants where event_slug = $1
       on conflict (participant_id) do update set
         balance = excluded.balance,
         revision = greatest(score_projections.revision, excluded.revision),
         last_transaction_at = excluded.last_transaction_at,
         updated_at = now()`,
      [eventSlug, JSON.stringify(balances), settings.revision],
    );
    return {
      eventSlug,
      participants: aggregates.rows.length,
      balances,
      revision: settings.revision,
    };
  });
}

async function lockSettings(client: PoolClient, eventSlug: string): Promise<ScoringSettings> {
  await client.query(
    `insert into event_scoring_settings (event_slug) values ($1) on conflict (event_slug) do nothing`,
    [eventSlug],
  );
  const result = await client.query<ScoringSettingsRow>(
    `select * from event_scoring_settings where event_slug = $1 for update`,
    [eventSlug],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Event scoring settings not found");
  return toSettings(row);
}

async function existingTransaction(
  client: PoolClient,
  eventSlug: string,
  idempotencyKey: string,
): Promise<ScoreTransaction | null> {
  const result = await client.query<TransactionRow>(
    `select * from score_transactions where event_slug = $1 and idempotency_key = $2`,
    [eventSlug, idempotencyKey],
  );
  const row = result.rows[0];
  if (!row) return null;
  const postings = await client.query<PostingRow>(
    `select participant_id, points, team_id from score_postings where transaction_id = $1 order by id`,
    [row.id],
  );
  return toTransaction(
    row,
    postings.rows.map((posting) => ({
      participantId: posting.participant_id,
      points: posting.points,
      teamId: posting.team_id ?? undefined,
    })),
  );
}

export async function recordScore(
  input: RecordScoreInput,
): Promise<ScoreStoreResult<ScoreTransaction>> {
  if (!input.eventSlug || !input.sourceId || !input.idempotencyKey || input.postings.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "A score source, idempotency key, and at least one posting are required",
    };
  }
  if (input.note && input.note.length > 1000) {
    return { ok: false, status: 400, error: "That note is too long" };
  }
  if (input.postings.some((posting) => !Number.isInteger(posting.points) || posting.points === 0)) {
    return { ok: false, status: 400, error: "Score postings must be whole non-zero points" };
  }

  try {
    return await transaction(async (client) => {
      const settings = await lockSettings(client, input.eventSlug);
      if (input.activityId) {
        const activity = await client.query<{ id: string }>(
          `select id from score_activities where id = $1 and event_slug = $2`,
          [input.activityId, input.eventSlug],
        );
        if (!activity.rows[0]) return { ok: false, status: 404, error: "Score activity not found" };
      }
      const duplicate = await existingTransaction(client, input.eventSlug, input.idempotencyKey);
      if (duplicate) return { ok: true, value: duplicate };

      let requestedStatus = input.status ?? "accepted";
      if (settings.state === "frozen" && requestedStatus === "accepted") {
        requestedStatus = "held";
      }
      if (settings.state === "closed" && requestedStatus === "accepted") {
        return {
          ok: false,
          status: 409,
          error: "Scoring is closed; this action needs admin review",
        };
      }
      if (settings.state !== "live" && requestedStatus === "accepted") {
        return { ok: false, status: 409, error: "Scoring is not live" };
      }

      const participantIds = [...new Set(input.postings.map((posting) => posting.participantId))];
      const participantResult = await client.query<{
        id: string;
        event_slug: string;
        status: string;
      }>(
        `select id, event_slug, status from event_participants
          where id = any($1::text[]) for update`,
        [participantIds],
      );
      if (
        participantResult.rows.length !== participantIds.length ||
        participantResult.rows.some(
          (participant) =>
            participant.event_slug !== input.eventSlug || participant.status !== "active",
        )
      ) {
        return { ok: false, status: 409, error: "One participant cannot receive this score" };
      }

      if (input.postings.some((posting) => posting.points < 0)) {
        const balances = await client.query<{ participant_id: string; balance: number }>(
          `select participant_id, balance from score_projections
            where participant_id = any($1::text[]) for update`,
          [participantIds],
        );
        const byParticipant = new Map(
          balances.rows.map((row) => [row.participant_id, row.balance]),
        );
        const deltas = new Map<string, number>();
        for (const posting of input.postings) {
          deltas.set(
            posting.participantId,
            (deltas.get(posting.participantId) ?? 0) + posting.points,
          );
        }
        for (const [participantId, delta] of deltas) {
          if ((byParticipant.get(participantId) ?? 0) + delta < 0) {
            return {
              ok: false,
              status: 409,
              error: "That correction would create a negative balance",
            };
          }
        }
      }

      return await insertTransaction(
        client,
        input,
        requestedStatus,
        requestedStatus === "accepted",
      );
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("score_transactions_source_idx")) {
      return { ok: false, status: 409, error: "This source has already been scored" };
    }
    if (error instanceof Error && error.message.includes("score_reversals_original_idx")) {
      return { ok: false, status: 409, error: "This score has already been reversed" };
    }
    throw error;
  }
}

async function insertTransaction(
  client: PoolClient,
  input: RecordScoreInput,
  status: ScoreTransactionStatus,
  updateProjection: boolean,
): Promise<ScoreStoreResult<ScoreTransaction>> {
  const positivePoints = input.postings.reduce(
    (sum, posting) => sum + Math.max(0, posting.points),
    0,
  );
  if (input.poolId && positivePoints > 0) {
    const pool = await client.query<{
      issued_points: number;
      reserved_points: number;
      spent_points: number;
      held_points: number;
    }>(
      `select issued_points, reserved_points, spent_points, held_points
         from score_pools
        where id = $1 and event_slug = $2
        for update`,
      [input.poolId, input.eventSlug],
    );
    const available = pool.rows[0]
      ? pool.rows[0].issued_points -
        pool.rows[0].reserved_points -
        pool.rows[0].spent_points -
        pool.rows[0].held_points
      : -1;
    if (available < positivePoints) {
      return { ok: false, status: 409, error: "The remaining points pool is too small" };
    }
    const column = status === "held" ? "held_points" : "spent_points";
    await client.query(
      `update score_pools set ${column} = ${column} + $2, updated_at = now() where id = $1`,
      [input.poolId, positivePoints],
    );
  }
  const transactionId = id("stx");
  const result = await client.query<TransactionRow>(
    `insert into score_transactions
       (id, event_slug, activity_id, source_type, source_id, idempotency_key, status,
        reason_code, note, rule_revision, actor_type, actor_id, station_id, device_id,
        original_transaction_id, metadata)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
     returning *`,
    [
      transactionId,
      input.eventSlug,
      input.activityId ?? null,
      input.sourceType,
      input.sourceId,
      input.idempotencyKey,
      status,
      input.reasonCode,
      input.note ?? null,
      input.ruleRevision ?? null,
      input.actorType,
      input.actorId ?? null,
      input.stationId ?? null,
      input.deviceId ?? null,
      input.originalTransactionId ?? null,
      JSON.stringify({ ...input.metadata, ...(input.poolId ? { poolId: input.poolId } : {}) }),
    ],
  );
  const row = result.rows[0];
  if (!row) return { ok: false, status: 500, error: "Score transaction could not be recorded" };

  for (const posting of input.postings) {
    const team = await client.query<{ team_id: string }>(
      `select team_id from score_team_memberships
        where participant_id = $1
          and starts_at <= now()
          and (ends_at is null or ends_at > now())
        order by starts_at desc limit 1`,
      [posting.participantId],
    );
    await client.query(
      `insert into score_postings
         (id, transaction_id, event_slug, participant_id, team_id, points)
       values ($1,$2,$3,$4,$5,$6)`,
      [
        id("sp").slice(0, 32),
        transactionId,
        input.eventSlug,
        posting.participantId,
        team.rows[0]?.team_id ?? posting.teamId ?? null,
        posting.points,
      ],
    );

    if (updateProjection) {
      await client.query(
        `insert into score_projections
           (participant_id, event_slug, balance, revision, last_transaction_at)
         values ($1,$2,$3,1,now())
         on conflict (participant_id) do update set
           balance = score_projections.balance + excluded.balance,
           revision = score_projections.revision + 1,
           last_transaction_at = now(),
           updated_at = now()`,
        [posting.participantId, input.eventSlug, posting.points],
      );
    }

    await client.query(
      `insert into score_notifications
         (id, event_slug, participant_id, transaction_id, kind, points)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (participant_id, transaction_id) do nothing`,
      [
        id("sn").slice(0, 32),
        input.eventSlug,
        posting.participantId,
        transactionId,
        status === "held" ? "held" : posting.points < 0 ? "negative" : "positive",
        posting.points,
      ],
    );
  }

  await client.query(
    `insert into score_audit_events
       (event_slug, action, actor_type, actor_id, assignment_id, station_id, device_id,
        entity_type, entity_id, metadata)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [
      input.eventSlug,
      `score.${status}`,
      input.actorType,
      input.actorId ?? null,
      input.assignmentId ?? null,
      input.stationId ?? null,
      input.deviceId ?? null,
      "score_transaction",
      transactionId,
      JSON.stringify({ sourceType: input.sourceType, sourceId: input.sourceId }),
    ],
  );

  return { ok: true, value: toTransaction(row, input.postings) };
}

export async function reverseScore(
  eventSlug: string,
  originalTransactionId: string,
  input: Omit<
    RecordScoreInput,
    "eventSlug" | "postings" | "sourceType" | "sourceId" | "originalTransactionId"
  >,
): Promise<ScoreStoreResult<ScoreTransaction>> {
  const original = await queryOne<{ status: ScoreTransactionStatus; event_slug: string }>(
    `select status, event_slug from score_transactions where id = $1 and event_slug = $2`,
    [originalTransactionId, eventSlug],
  );
  if (!original) return { ok: false, status: 404, error: "Original score was not found" };
  if (original.status !== "accepted") {
    return { ok: false, status: 409, error: "Only an accepted score can be reversed" };
  }
  const originals = await query<PostingRow>(
    `select participant_id, points, team_id from score_postings where transaction_id = $1`,
    [originalTransactionId],
  );
  if (originals.length === 0)
    return { ok: false, status: 404, error: "Original score was not found" };
  return recordScore({
    ...input,
    eventSlug,
    sourceType: "reversal",
    sourceId: originalTransactionId,
    originalTransactionId,
    postings: originals.map((posting) => ({
      participantId: posting.participant_id,
      points: -posting.points,
      teamId: posting.team_id ?? undefined,
    })),
  });
}

export async function acceptHeldScore(
  eventSlug: string,
  transactionId: string,
  input: {
    actorType: "admin" | "staff" | "system";
    actorId?: string;
    note?: string;
  },
): Promise<ScoreStoreResult<ScoreTransaction>> {
  return transaction(async (client) => {
    const settings = await lockSettings(client, eventSlug);
    if (settings.state !== "live") {
      return { ok: false, status: 409, error: "Resume scoring before accepting held work" };
    }
    const result = await client.query<TransactionRow & { metadata: unknown }>(
      `select * from score_transactions
          where id = $1 and event_slug = $2 and status = 'held'
          for update`,
      [transactionId, eventSlug],
    );
    const row = result.rows[0];
    if (!row) return { ok: false, status: 404, error: "Held score was not found" };
    const postings = await client.query<PostingRow>(
      `select participant_id, points, team_id
           from score_postings
          where transaction_id = $1
          order by id`,
      [transactionId],
    );
    const participantIds = [...new Set(postings.rows.map((posting) => posting.participant_id))];
    const participants = await client.query<{ id: string; status: string }>(
      `select id, status from event_participants where id = any($1::text[]) for update`,
      [participantIds],
    );
    if (
      participants.rows.length !== participantIds.length ||
      participants.rows.some((participant) => participant.status !== "active")
    ) {
      return { ok: false, status: 409, error: "A held participant cannot receive this score" };
    }

    const balances = await client.query<{ participant_id: string; balance: number }>(
      `select participant_id, balance from score_projections
         where participant_id = any($1::text[]) for update`,
      [participantIds],
    );
    const byParticipant = new Map(
      balances.rows.map((entry) => [entry.participant_id, entry.balance]),
    );
    const deltas = new Map<string, number>();
    for (const posting of postings.rows) {
      deltas.set(
        posting.participant_id,
        (deltas.get(posting.participant_id) ?? 0) + posting.points,
      );
    }
    for (const [participantId, delta] of deltas) {
      if ((byParticipant.get(participantId) ?? 0) + delta < 0) {
        return {
          ok: false,
          status: 409,
          error: "A held correction would create a negative balance",
        };
      }
    }

    const metadata = recordObject(row.metadata);
    const poolId = typeof metadata.poolId === "string" ? metadata.poolId : undefined;
    const positivePoints = postings.rows.reduce(
      (sum, posting) => sum + Math.max(0, posting.points),
      0,
    );
    if (poolId && positivePoints > 0) {
      const pool = await client.query<{ id: string }>(
        `update score_pools
              set held_points = held_points - $2,
                  spent_points = spent_points + $2,
                  updated_at = now()
            where id = $1 and event_slug = $3 and held_points >= $2
            returning id`,
        [poolId, positivePoints, eventSlug],
      );
      if (pool.rows.length === 0)
        return { ok: false, status: 409, error: "The held points pool is no longer available" };
    }
    await client.query(
      `update score_transactions
            set status = 'accepted'
          where id = $1`,
      [transactionId],
    );
    for (const posting of postings.rows) {
      await client.query(
        `insert into score_projections
             (participant_id, event_slug, balance, revision, last_transaction_at)
           values ($1,$2,$3,1,now())
           on conflict (participant_id) do update set
             balance = score_projections.balance + excluded.balance,
             revision = score_projections.revision + 1,
             last_transaction_at = now(),
             updated_at = now()`,
        [posting.participant_id, eventSlug, posting.points],
      );
    }
    await client.query(
      `insert into score_audit_events
           (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
         values ($1,'score.held.accepted',$2,$3,'score_transaction',$4,$5::jsonb)`,
      [
        eventSlug,
        input.actorType,
        input.actorId ?? null,
        transactionId,
        JSON.stringify({ note: input.note ?? null }),
      ],
    );
    return {
      ok: true,
      value: toTransaction(
        { ...row, status: "accepted" },
        postings.rows.map((posting) => ({
          participantId: posting.participant_id,
          points: posting.points,
          teamId: posting.team_id ?? undefined,
        })),
      ),
    };
  });
}

export async function createPool(input: {
  eventSlug: string;
  activityId?: string;
  ownerType: "event" | "staff" | "station" | "activity";
  ownerId?: string;
  points: number;
}): Promise<ScoreStoreResult<{ id: string; available: number }>> {
  const points = Math.trunc(input.points);
  if (!Number.isInteger(points) || points < 0)
    return { ok: false, status: 400, error: "Pool points must be zero or more" };
  const row = await queryOne<{ id: string; issued_points: number }>(
    `insert into score_pools (id, event_slug, activity_id, owner_type, owner_id, issued_points)
     values ($1,$2,$3,$4,$5,$6)
     returning id, issued_points`,
    [
      id("pool"),
      input.eventSlug,
      input.activityId ?? null,
      input.ownerType,
      input.ownerId ?? null,
      points,
    ],
  );
  if (!row) return { ok: false, status: 500, error: "Point pool could not be created" };
  return { ok: true, value: { id: row.id, available: row.issued_points } };
}

export async function adjustPool(
  poolId: string,
  delta: number,
): Promise<ScoreStoreResult<{ issued: number; available: number }>> {
  const amount = Math.trunc(delta);
  if (!Number.isInteger(amount) || amount === 0)
    return { ok: false, status: 400, error: "Pool adjustment must be a non-zero whole number" };
  const row = await queryOne<{
    issued_points: number;
    reserved_points: number;
    spent_points: number;
    held_points: number;
  }>(
    `update score_pools
        set issued_points = issued_points + $2, updated_at = now()
      where id = $1
        and issued_points + $2 >= reserved_points + spent_points + held_points
      returning issued_points, reserved_points, spent_points, held_points`,
    [poolId, amount],
  );
  if (!row)
    return {
      ok: false,
      status: 409,
      error: "The pool adjustment would make issued points unavailable",
    };
  return {
    ok: true,
    value: {
      issued: row.issued_points,
      available: row.issued_points - row.reserved_points - row.spent_points - row.held_points,
    },
  };
}

export async function listPools(eventSlug: string): Promise<
  {
    id: string;
    activityId?: string;
    ownerType: string;
    ownerId?: string;
    issued: number;
    reserved: number;
    spent: number;
    held: number;
    available: number;
  }[]
> {
  const rows = await query<{
    id: string;
    activity_id: string | null;
    owner_type: string;
    owner_id: string | null;
    issued_points: number;
    reserved_points: number;
    spent_points: number;
    held_points: number;
  }>(`select * from score_pools where event_slug = $1 order by created_at, id`, [eventSlug]);
  return rows.map((row) => ({
    id: row.id,
    activityId: row.activity_id ?? undefined,
    ownerType: row.owner_type,
    ownerId: row.owner_id ?? undefined,
    issued: row.issued_points,
    reserved: row.reserved_points,
    spent: row.spent_points,
    held: row.held_points,
    available: row.issued_points - row.reserved_points - row.spent_points - row.held_points,
  }));
}

export async function createStaffAssignment(input: {
  eventSlug: string;
  label: string;
  assignmentType: StaffAssignmentType;
  token: string;
  permissions: StaffPermissionSet;
  scope?: Record<string, unknown>;
  expiresAt?: string;
}): Promise<StoredStaffAssignment> {
  const row = await queryOne<StaffAssignmentRow>(
    `insert into score_staff_assignments
       (id, event_slug, label, assignment_type, token_hash, permissions, scope, expires_at)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)
     returning *`,
    [
      id("staff"),
      input.eventSlug,
      input.label.trim(),
      input.assignmentType,
      hashStaffToken(input.token),
      JSON.stringify(input.permissions),
      JSON.stringify(input.scope ?? {}),
      input.expiresAt ?? null,
    ],
  );
  if (!row) throw new Error("Staff assignment could not be created");
  return toStaffAssignment(row);
}

function toStaffAssignment(row: StaffAssignmentRow): StoredStaffAssignment {
  return {
    id: row.id,
    eventSlug: row.event_slug,
    label: row.label,
    assignmentType: row.assignment_type as StaffAssignmentType,
    permissions: recordObject(row.permissions) as unknown as StaffPermissionSet,
    scope: recordObject(row.scope),
    status: row.status as StaffAssignmentStatus,
    expiresAt: iso(row.expires_at),
    revokedAt: iso(row.revoked_at),
  };
}

export async function resolveStaffAssignment(
  eventSlug: string,
  token: string,
): Promise<StoredStaffAssignment | null> {
  const row = await queryOne<StaffAssignmentRow>(
    `update score_staff_assignments
        set status = case when expires_at is not null and expires_at <= now() then 'expired' else status end
      where event_slug = $1 and token_hash = $2
      returning *`,
    [eventSlug, hashStaffToken(token)],
  );
  if (!row || row.status !== "active" || (row.expires_at && row.expires_at <= new Date()))
    return null;
  return toStaffAssignment(row);
}

export async function revokeStaffAssignment(assignmentId: string): Promise<boolean> {
  const rows = await query(
    `update score_staff_assignments set status = 'revoked', revoked_at = now() where id = $1`,
    [assignmentId],
  );
  return rows.length > 0;
}

export async function recordStaffDevice(assignmentId: string, deviceId: string): Promise<void> {
  await query(
    `insert into score_staff_devices (assignment_id, device_id)
     values ($1,$2)
     on conflict (assignment_id, device_id) do update set last_seen_at = now(), revoked_at = null`,
    [assignmentId, deviceId],
  );
}

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
