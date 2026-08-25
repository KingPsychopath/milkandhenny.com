import { query, queryOne } from "@/lib/platform/postgres.server";
import type {
  ScoreAuditEvent,
  ScoreMediaLink,
  ScoreNotification,
  ScoreSourceType,
  ScoreTransaction,
  ScoreTransactionStatus,
} from "../types";
import {
  id,
  recordObject,
  toTransaction,
  type PostingRow,
  type ScoreStoreResult,
  type TransactionRow,
} from "./common.server";

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
    reason_code: string;
    delivered_at: Date | null;
    created_at: Date;
  }>(
    `select notifications.id, notifications.participant_id, notifications.transaction_id,
            notifications.kind, notifications.points, transactions.reason_code,
            notifications.delivered_at, notifications.created_at
       from score_notifications notifications
       join score_transactions transactions on transactions.id = notifications.transaction_id
      where notifications.participant_id = $1
        and ($2 = false or notifications.delivered_at is null)
      order by notifications.created_at, notifications.id
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
    reasonCode: row.reason_code as ScoreNotification["reasonCode"],
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
  sourceType?: ScoreSourceType;
  status?: ScoreTransactionStatus;
  from?: string;
  to?: string;
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
    `select audit.* from score_audit_events audit
       left join score_transactions transaction
         on audit.entity_type = 'score_transaction' and transaction.id = audit.entity_id
      where audit.event_slug = $1
        and ($2::text is null or $2 in (audit.actor_id, audit.assignment_id, audit.station_id, audit.device_id))
        and ($3::text is null or exists (
          select 1 from score_postings posting
           where posting.transaction_id = transaction.id and posting.participant_id = $3
        ))
        and ($4::text is null or transaction.activity_id = $4)
        and ($5::text is null or transaction.source_type = $5)
        and ($6::text is null or transaction.status = $6)
        and ($7::timestamptz is null or audit.created_at >= $7)
        and ($8::timestamptz is null or audit.created_at <= $8)
      order by audit.created_at desc, audit.id desc
      limit $9`,
    [
      input.eventSlug,
      input.actorId ?? null,
      input.participantId ?? null,
      input.activityId ?? null,
      input.sourceType ?? null,
      input.status ?? null,
      input.from ?? null,
      input.to ?? null,
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

export async function listScoreMediaLinks(eventSlug: string): Promise<ScoreMediaLink[]> {
  const rows = await query<{
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
  }>(`select * from score_media_links where event_slug = $1 order by created_at desc`, [eventSlug]);
  return rows.map((row) => ({
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
  }));
}

export async function listParticipantMerges(eventSlug: string): Promise<
  Array<{
    id: string;
    sourceParticipantId: string;
    targetParticipantId: string;
    reason: string;
    createdAt: string;
  }>
> {
  const rows = await query<{
    id: string;
    source_participant_id: string;
    target_participant_id: string;
    reason: string;
    created_at: Date;
  }>(
    `select id, source_participant_id, target_participant_id, reason, created_at
       from event_participant_merges where event_slug = $1 and reversed_at is null order by created_at desc`,
    [eventSlug],
  );
  return rows.map((row) => ({
    id: row.id,
    sourceParticipantId: row.source_participant_id,
    targetParticipantId: row.target_participant_id,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
  }));
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
