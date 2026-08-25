import type { PoolClient } from "pg";

import { query, transaction } from "@/lib/platform/postgres.server";
import type {
  ScoreRule,
  ScoreTransaction,
  ScoringSettings,
  ScoreTransactionStatus,
} from "../types";
import {
  id,
  recordObject,
  toSettings,
  toTransaction,
  type PostingRow,
  type RecordScoreInput,
  type ScoreStoreResult,
  type ScoringSettingsRow,
  type TransactionRow,
} from "./common.server";

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
      `with recursive participant_targets as (
         select id as source_id, id as target_id, array[id] as path
           from event_participants
          where event_slug = $1
         union all
         select targets.source_id,
                merges.target_participant_id,
                targets.path || merges.target_participant_id
           from participant_targets targets
           join event_participant_merges merges
             on merges.source_participant_id = targets.target_id
            and merges.reversed_at is null
          where not merges.target_participant_id = any(targets.path)
       ), resolved_targets as (
         select distinct on (source_id) source_id, target_id
           from participant_targets
          order by source_id, cardinality(path) desc
       )
       select resolved.target_id as participant_id,
              sum(postings.points)::text as balance,
              count(*)::text as postings
         from score_postings postings
         join score_transactions transactions on transactions.id = postings.transaction_id
         join resolved_targets resolved on resolved.source_id = postings.participant_id
        where postings.event_slug = $1 and transactions.status = 'accepted'
        group by resolved.target_id`,
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
  try {
    return await transaction((client) => recordScoreInTransaction(client, input));
  } catch (error) {
    return scoreConstraintError(error);
  }
}

export async function recordScoreInTransaction(
  client: PoolClient,
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

  const settings = await lockSettings(client, input.eventSlug);
  let activityRule: ScoreRule | null = null;
  if (input.activityId) {
    const activity = await client.query<{ id: string; rule: unknown }>(
      `select id, rule from score_activities where id = $1 and event_slug = $2`,
      [input.activityId, input.eventSlug],
    );
    if (!activity.rows[0]) return { ok: false, status: 404, error: "Score activity not found" };
    activityRule = activity.rows[0].rule as ScoreRule;
  }
  const duplicate = await existingTransaction(client, input.eventSlug, input.idempotencyKey);
  if (duplicate) return { ok: true, value: duplicate };

  let requestedStatus = input.status ?? "accepted";
  if (settings.state === "frozen" && requestedStatus === "accepted") {
    requestedStatus = "held";
  }
  const allowedClosedCorrection =
    settings.state === "closed" &&
    requestedStatus === "accepted" &&
    input.sourceType === "correction" &&
    input.metadata?.closedCorrectionConfirmed === true &&
    Boolean(input.note?.trim());
  if (settings.state === "closed" && requestedStatus === "accepted") {
    if (!allowedClosedCorrection) {
      return {
        ok: false,
        status: 409,
        error: "Scoring is closed; this correction needs a reason and confirmation",
      };
    }
  }
  if (settings.state !== "live" && requestedStatus === "accepted" && !allowedClosedCorrection) {
    return { ok: false, status: 409, error: "Scoring is not live" };
  }
  const event = await client.query<{ status: string }>(
    `select status from events where slug = $1 for share`,
    [input.eventSlug],
  );
  if (
    (event.rows[0]?.status === "cancelled" || event.rows[0]?.status === "archived") &&
    input.sourceType !== "reversal" &&
    input.sourceType !== "correction"
  ) {
    return { ok: false, status: 409, error: "This event is not accepting score actions" };
  }

  const participantIds = [...new Set(input.postings.map((posting) => posting.participantId))];
  if (input.assignmentId && !settings.allowStaffSelfAwards) {
    const selfAward = await client.query<{ participant_id: string }>(
      `select participants.id as participant_id
         from score_staff_assignments assignments
         join event_participants participants on participants.person_id = assignments.person_id
        where assignments.id = $1 and participants.id = any($2::text[])
        limit 1`,
      [input.assignmentId, participantIds],
    );
    if (selfAward.rows[0]) {
      await client.query(
        `insert into score_audit_events
           (event_slug,action,actor_type,actor_id,assignment_id,station_id,device_id,entity_type,entity_id,metadata)
         values ($1,'security.self-award.blocked','staff',$2,$3,$4,$5,'participant',$6,$7::jsonb)`,
        [
          input.eventSlug,
          input.actorId ?? null,
          input.assignmentId,
          input.stationId ?? null,
          input.deviceId ?? null,
          selfAward.rows[0].participant_id,
          JSON.stringify({ activityId: input.activityId ?? null }),
        ],
      );
      return {
        ok: false,
        status: 403,
        error: "This event does not allow staff to award themselves",
      };
    }
  }

  const participantResult = await client.query<{
    id: string;
    event_slug: string;
    status: string;
    checked_in_at: Date | null;
  }>(
    `select id, event_slug, status, checked_in_at from event_participants
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

  const activityAward = ["manual", "game", "discovery", "check-in"].includes(input.sourceType);
  if (
    activityAward &&
    activityRule?.requiresCheckIn &&
    participantResult.rows.some((participant) => !participant.checked_in_at)
  ) {
    return { ok: false, status: 409, error: "Check in before receiving this activity score" };
  }
  if (activityAward && input.activityId && activityRule?.repeat === "once") {
    const prior = await client.query<{ participant_id: string }>(
      `select distinct postings.participant_id
         from score_transactions transactions
         join score_postings postings on postings.transaction_id = transactions.id
        where transactions.event_slug = $1 and transactions.activity_id = $2
          and transactions.status in ('accepted', 'held')
          and postings.participant_id = any($3::text[])
        limit 1`,
      [input.eventSlug, input.activityId, participantIds],
    );
    if (prior.rows[0]) {
      return { ok: false, status: 409, error: "This activity can award each participant once" };
    }
  }
  if (activityAward && input.activityId && activityRule?.repeat === "once-per-source") {
    const prior = await client.query<{ id: string }>(
      `select id from score_transactions
        where event_slug = $1 and activity_id = $2 and source_id = $3
          and status in ('accepted', 'held')
        limit 1`,
      [input.eventSlug, input.activityId, input.sourceId],
    );
    if (prior.rows[0]) {
      return { ok: false, status: 409, error: "This activity source has already been scored" };
    }
  }

  if (input.sourceType !== "reversal" && input.postings.some((posting) => posting.points < 0)) {
    const balances = await client.query<{ participant_id: string; balance: number }>(
      `select participant_id, balance from score_projections
            where participant_id = any($1::text[]) for update`,
      [participantIds],
    );
    const byParticipant = new Map(balances.rows.map((row) => [row.participant_id, row.balance]));
    const deltas = new Map<string, number>();
    for (const posting of input.postings) {
      deltas.set(posting.participantId, (deltas.get(posting.participantId) ?? 0) + posting.points);
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

  const inserted = await insertTransaction(
    client,
    input,
    requestedStatus,
    requestedStatus === "accepted",
  );
  if (inserted.ok && settings.state === "closed" && input.sourceType === "correction") {
    await client.query(
      `update score_prize_finalizations
          set status = 'provisional', updated_at = now()
        where event_slug = $1 and status = 'final'`,
      [input.eventSlug],
    );
  }
  return inserted;
}

function scoreConstraintError(error: unknown): never | ScoreStoreResult<ScoreTransaction> {
  if (error instanceof Error && error.message.includes("score_transactions_source_idx")) {
    return { ok: false, status: 409, error: "This source has already been scored" };
  }
  if (error instanceof Error && error.message.includes("score_reversals_original_idx")) {
    return { ok: false, status: 409, error: "This score has already been reversed" };
  }
  throw error;
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
          and event_slug = $2
          and starts_at <= clock_timestamp()
          and (ends_at is null or ends_at > clock_timestamp())
        order by starts_at desc limit 1`,
      [posting.participantId, input.eventSlug],
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

  if (input.actorType === "staff" && (input.assignmentId || input.deviceId)) {
    const recent = await client.query<{ count: string }>(
      `select count(*)::text as count from score_transactions
        where event_slug = $1 and created_at >= now() - interval '60 seconds'
          and ($2::text is null or activity_id = $2)
          and ($3::text is null or actor_id = $3)
          and ($4::text is null or device_id = $4)`,
      [input.eventSlug, input.activityId ?? null, input.actorId ?? null, input.deviceId ?? null],
    );
    const count = Number(recent.rows[0]?.count ?? 0);
    if (count >= 20) {
      await client.query(
        `insert into score_anomaly_flags
           (event_slug,transaction_id,participant_id,activity_id,actor_id,assignment_id,station_id,device_id,signal,detail)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'rapid-repetition',$9::jsonb)`,
        [
          input.eventSlug,
          transactionId,
          input.postings[0]?.participantId ?? null,
          input.activityId ?? null,
          input.actorId ?? null,
          input.assignmentId ?? null,
          input.stationId ?? null,
          input.deviceId ?? null,
          JSON.stringify({ actionsInMinute: count }),
        ],
      );
    }
  }

  return { ok: true, value: toTransaction(row, input.postings) };
}

export async function listScoreAnomalyFlags(eventSlug: string) {
  const rows = await query<{
    id: string | number;
    transaction_id: string | null;
    participant_id: string | null;
    activity_id: string | null;
    actor_id: string | null;
    assignment_id: string | null;
    station_id: string | null;
    device_id: string | null;
    signal: string;
    detail: unknown;
    state: string;
    created_at: Date;
  }>(
    `select * from score_anomaly_flags where event_slug = $1 order by created_at desc, id desc limit 200`,
    [eventSlug],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    transactionId: row.transaction_id ?? undefined,
    participantId: row.participant_id ?? undefined,
    activityId: row.activity_id ?? undefined,
    actorId: row.actor_id ?? undefined,
    assignmentId: row.assignment_id ?? undefined,
    stationId: row.station_id ?? undefined,
    deviceId: row.device_id ?? undefined,
    signal: row.signal,
    detail: recordObject(row.detail),
    state: row.state,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function reverseScore(
  eventSlug: string,
  originalTransactionId: string,
  input: Omit<
    RecordScoreInput,
    "eventSlug" | "postings" | "sourceType" | "sourceId" | "originalTransactionId"
  >,
): Promise<ScoreStoreResult<ScoreTransaction>> {
  try {
    return await transaction((client) =>
      reverseScoreInTransaction(client, eventSlug, originalTransactionId, input),
    );
  } catch (error) {
    return scoreConstraintError(error);
  }
}

export async function reverseScoreInTransaction(
  client: PoolClient,
  eventSlug: string,
  originalTransactionId: string,
  input: Omit<
    RecordScoreInput,
    "eventSlug" | "postings" | "sourceType" | "sourceId" | "originalTransactionId"
  >,
): Promise<ScoreStoreResult<ScoreTransaction>> {
  const originalResult = await client.query<{
    status: ScoreTransactionStatus;
    event_slug: string;
  }>(
    `select status, event_slug from score_transactions where id = $1 and event_slug = $2 for update`,
    [originalTransactionId, eventSlug],
  );
  const original = originalResult.rows[0];
  if (!original) return { ok: false, status: 404, error: "Original score was not found" };
  if (original.status !== "accepted") {
    return { ok: false, status: 409, error: "Only an accepted score can be reversed" };
  }
  const originals = await client.query<PostingRow>(
    `select participant_id, points, team_id from score_postings where transaction_id = $1`,
    [originalTransactionId],
  );
  if (originals.rows.length === 0)
    return { ok: false, status: 404, error: "Original score was not found" };
  return recordScoreInTransaction(client, {
    ...input,
    eventSlug,
    sourceType: "reversal",
    sourceId: originalTransactionId,
    originalTransactionId,
    postings: originals.rows.map((posting) => ({
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
