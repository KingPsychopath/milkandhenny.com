import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { enqueueMediaObjectOperation } from "@/features/media/object-operations.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import { getGenerationTransferAssetKeys } from "./media-state";
import type { TransferMediaJob } from "./media-queue.server";
import type { TransferFile } from "./types";

type JobRow = {
  id: string;
  transfer_id: string;
  file_id: string;
  generation: number;
  idempotency_key: string;
  payload: TransferMediaJob;
  attempts: number;
  max_attempts: number;
  payload_matches?: boolean;
};

export type ClaimedPostgresTransferMediaJob = {
  id: string;
  claimToken: string;
  generation: number;
  job: TransferMediaJob;
};

export type PostgresTransferMediaQueueSnapshot = {
  pending: number;
  claimed: number;
  dead: number;
  completed: number;
  cancelled: number;
  due: number;
  expiredClaims: number;
  oldestPendingAt: string | null;
  oldestDeadAt: string | null;
};

/** One aggregate state read for admin health and CLI diagnostics; never expose job payloads. */
export async function getPostgresTransferMediaQueueSnapshot(): Promise<PostgresTransferMediaQueueSnapshot> {
  const rows = await query<{
    pending: string;
    claimed: string;
    dead: string;
    completed: string;
    cancelled: string;
    due: string;
    expired_claims: string;
    oldest_pending_at: Date | null;
    oldest_dead_at: Date | null;
  }>(
    `select
       count(*) filter (where status='pending')::text as pending,
       count(*) filter (where status='claimed')::text as claimed,
       count(*) filter (where status='dead')::text as dead,
       count(*) filter (where status='completed')::text as completed,
       count(*) filter (where status='cancelled')::text as cancelled,
       count(*) filter (where status='pending' and available_at <= clock_timestamp())::text as due,
       count(*) filter (where status='claimed' and lease_until <= clock_timestamp())::text
         as expired_claims,
       min(enqueued_at) filter (where status='pending') as oldest_pending_at,
       min(enqueued_at) filter (where status='dead') as oldest_dead_at
       from transfer_media_jobs`,
  );
  const row = rows[0];
  if (!row) throw new Error("Transfer media queue snapshot unavailable");
  return {
    pending: Number(row.pending),
    claimed: Number(row.claimed),
    dead: Number(row.dead),
    completed: Number(row.completed),
    cancelled: Number(row.cancelled),
    due: Number(row.due),
    expiredClaims: Number(row.expired_claims),
    oldestPendingAt: row.oldest_pending_at?.toISOString() ?? null,
    oldestDeadAt: row.oldest_dead_at?.toISOString() ?? null,
  };
}

/** Grant one more attempt while preserving the existing claim and failure history. */
export async function retryDeadPostgresTransferMediaJobs(limit = 25): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid transfer media retry limit");
  const rows = await query<{ id: string }>(
    `with retryable as (
       select j.id from transfer_media_jobs j
       join transfers t on t.id=j.transfer_id
       join transfer_files f on f.transfer_id=j.transfer_id and f.id=j.file_id
        where j.status='dead'
          and t.deleted_at is null and t.expires_at > clock_timestamp()
          and f.processing_generation=j.generation
          and f.storage_key=j.payload->>'storageKey'
        order by j.enqueued_at,j.id
        limit $1 for update of j skip locked
     )
     update transfer_media_jobs j
        set status='pending',available_at=clock_timestamp(),
            max_attempts=greatest(j.max_attempts,j.attempts+1),last_error=null
       from retryable where j.id=retryable.id
     returning j.id`,
    [limit],
  );
  return rows.length;
}

/** Stage private-object deletion only after an attempt can no longer publish. */
export async function enqueueAbandonedPostgresTransferMediaOutputs(limit = 50): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid transfer media cleanup limit");
  return transaction(async (client) => {
    const rows = await client.query<{
      transfer_id: string;
      generation: number;
      thumb_key: string;
      full_key: string | null;
    }>(
      `select j.transfer_id,j.generation,o.thumb_key,o.full_key
         from transfer_media_job_attempt_outputs o
         join transfer_media_jobs j on j.id=o.job_id
         left join transfer_files f on f.transfer_id=j.transfer_id and f.id=j.file_id
        where o.created_at < clock_timestamp()-interval '35 minutes'
          and o.claim_token is distinct from f.derivative_claim_token
          and not (j.status='claimed' and j.claim_token=o.claim_token
                   and j.lease_until > clock_timestamp())
          and not exists (
            select 1 from media_object_operations m
             where m.owner_kind='transfer' and m.owner_id=j.transfer_id
               and m.owner_revision=j.generation and m.operation='delete'
               and m.target_scope='private' and m.target_key=o.thumb_key
          )
        order by o.created_at,o.job_id,o.claim_token
        limit $1 for update of o,j skip locked`,
      [limit],
    );
    for (const row of rows.rows) {
      for (const key of [row.thumb_key, row.full_key]) {
        if (!key) continue;
        if (!key.startsWith(`transfers/${row.transfer_id}/`))
          throw new Error("Transfer media attempt output escaped its owner prefix");
        await enqueueMediaObjectOperation(client, {
          ownerKind: "transfer",
          ownerId: row.transfer_id,
          ownerRevision: row.generation,
          operation: "delete",
          targetScope: "private",
          targetKey: key,
        });
      }
    }
    return rows.rowCount ?? 0;
  });
}

function validateLease(leaseMs: number): void {
  if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 30 * 60_000)
    throw new Error("Invalid transfer media lease");
}

function normalizedJob(job: TransferMediaJob): TransferMediaJob {
  const mediaId = job.mediaId ?? job.file.mediaId ?? job.file.name;
  return {
    ...job,
    mediaId,
    idempotencyKey:
      job.idempotencyKey ??
      createHash("sha256")
        .update([job.transferId, mediaId, job.processingRoute, job.attempt].join(":"))
        .digest("base64url"),
    deliveryAttempt: 0,
  };
}

/** Enqueue in the same transaction that creates or advances the source file. */
export async function enqueuePostgresTransferMediaJob(
  client: PoolClient,
  job: TransferMediaJob,
  generation: number,
): Promise<string> {
  if (
    !job.transferId ||
    !job.storageKey ||
    !job.processingRoute ||
    !job.mimeType ||
    !Number.isInteger(generation) ||
    generation < 1 ||
    job.attempt !== generation ||
    !Number.isFinite(Date.parse(job.enqueuedAt))
  )
    throw new Error("Invalid transfer media job");
  const normalized = normalizedJob(job);
  const fileId = normalized.mediaId;
  if (!fileId) throw new Error("Transfer media job has no source file");
  const expected = getGenerationTransferAssetKeys(
    job.transferId,
    job.file.name,
    job.processingRoute,
    fileId,
    generation,
  );
  if (
    !expected.thumbKey ||
    job.expectedThumbKey !== expected.thumbKey ||
    job.expectedFullKey !== expected.fullKey
  )
    throw new Error("Transfer media job output generation is invalid");
  const source = await client.query<{ processing_generation: number; storage_key: string }>(
    `select f.processing_generation,f.storage_key
       from transfer_files f join transfers t on t.id=f.transfer_id
      where f.transfer_id=$1 and f.id=$2
        and t.deleted_at is null and t.expires_at > clock_timestamp()
      for update of f,t`,
    [job.transferId, fileId],
  );
  if (
    source.rows[0]?.processing_generation !== generation ||
    source.rows[0].storage_key !== job.storageKey
  )
    throw new Error("Transfer media job source generation is unavailable");
  const id = randomUUID();
  const inserted = await client.query<{ id: string }>(
    `insert into transfer_media_jobs
       (id,transfer_id,file_id,operation,generation,idempotency_key,payload,enqueued_at)
     values ($1,$2,$3,'process',$4,$5,$6::jsonb,$7)
     on conflict (transfer_id,file_id,operation,generation) do nothing returning id`,
    [
      id,
      job.transferId,
      fileId,
      generation,
      normalized.idempotencyKey,
      JSON.stringify(normalized),
      job.enqueuedAt,
    ],
  );
  if (inserted.rows[0]) return inserted.rows[0].id;
  const existing = await client.query<JobRow>(
    `select id,transfer_id,file_id,generation,idempotency_key,payload,attempts,max_attempts,
            payload=$4::jsonb as payload_matches
       from transfer_media_jobs
      where transfer_id=$1 and file_id=$2 and operation='process' and generation=$3`,
    [job.transferId, fileId, generation, JSON.stringify(normalized)],
  );
  const row = existing.rows[0];
  if (!row || row.idempotency_key !== normalized.idempotencyKey || !row.payload_matches)
    throw new Error("Conflicting transfer media job identity");
  return row.id;
}

export async function claimPostgresTransferMediaJobs(
  owner: string,
  limit = 1,
  leaseMs = 30 * 60_000,
): Promise<ClaimedPostgresTransferMediaJob[]> {
  if (
    !/^[A-Za-z0-9._:-]{1,128}$/.test(owner) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 25
  )
    throw new Error("Invalid transfer media claim");
  validateLease(leaseMs);
  return transaction(async (client) => {
    await client.query(
      `with exhausted as (
         select id from transfer_media_jobs
          where status='claimed' and lease_until <= clock_timestamp()
            and attempts >= max_attempts
          order by lease_until,id
          limit $1 for update skip locked
       )
       update transfer_media_jobs j
          set status='dead',claim_token=null,claim_owner=null,lease_until=null,
              last_error=coalesce(last_error,'lease expired after final attempt')
         from exhausted where j.id=exhausted.id`,
      [limit],
    );
    const picked = await client.query<JobRow>(
      `select j.id,j.transfer_id,j.file_id,j.generation,j.idempotency_key,
              j.payload,j.attempts,j.max_attempts
         from transfer_media_jobs j
         join transfers t on t.id=j.transfer_id
         join transfer_files f on f.transfer_id=j.transfer_id and f.id=j.file_id
        where ((j.status='pending' and j.available_at <= clock_timestamp()) or
               (j.status='claimed' and j.lease_until <= clock_timestamp()))
          and j.attempts < j.max_attempts
          and t.deleted_at is null and t.expires_at > clock_timestamp()
          and f.processing_generation=j.generation
        order by j.available_at,j.enqueued_at,j.id
        for update of j skip locked
        limit $1`,
      [limit],
    );
    const claimed: ClaimedPostgresTransferMediaJob[] = [];
    for (const row of picked.rows) {
      const claimToken = randomUUID();
      const outputs = getGenerationTransferAssetKeys(
        row.transfer_id,
        row.payload.file.name,
        row.payload.processingRoute,
        row.file_id,
        row.generation,
        claimToken,
      );
      if (!outputs.thumbKey) throw new Error("Transfer media claim has no output key");
      await client.query(
        `insert into transfer_media_job_attempt_outputs
           (job_id,claim_token,thumb_key,full_key)
         values ($1,$2,$3,$4)`,
        [row.id, claimToken, outputs.thumbKey, outputs.fullKey ?? null],
      );
      await client.query(
        `update transfer_media_jobs
            set status='claimed',attempts=attempts+1,claim_token=$2,
                claim_owner=$3,lease_until=clock_timestamp()+$4*interval '1 millisecond'
          where id=$1`,
        [row.id, claimToken, owner, leaseMs],
      );
      claimed.push({
        id: row.id,
        claimToken,
        generation: row.generation,
        job: {
          ...row.payload,
          expectedThumbKey: outputs.thumbKey,
          expectedFullKey: outputs.fullKey,
          deliveryAttempt: row.attempts,
        },
      });
    }
    return claimed;
  });
}

export async function renewPostgresTransferMediaJob(
  id: string,
  token: string,
  leaseMs = 30 * 60_000,
): Promise<boolean> {
  validateLease(leaseMs);
  const rows = await query<{ id: string }>(
    `update transfer_media_jobs j
        set lease_until=clock_timestamp()+$3*interval '1 millisecond'
      where j.id=$1 and j.claim_token=$2 and j.status='claimed'
        and j.lease_until > clock_timestamp()
        and exists (
          select 1 from transfers t join transfer_files f
            on f.transfer_id=t.id
           where t.id=j.transfer_id and f.id=j.file_id
             and t.deleted_at is null and t.expires_at > clock_timestamp()
             and f.processing_generation=j.generation
        )
      returning j.id`,
    [id, token, leaseMs],
  );
  return rows.length === 1;
}

/** Use inside the transaction that commits the fenced file result. */
export async function completePostgresTransferMediaJob(
  client: PoolClient,
  id: string,
  token: string,
  file: TransferFile | null,
): Promise<boolean> {
  const job = await client.query<{ transfer_id: string; file_id: string; generation: number }>(
    "select transfer_id,file_id,generation from transfer_media_jobs where id=$1",
    [id],
  );
  const target = job.rows[0];
  if (!target) return false;
  const source = await client.query<{ id: string; storage_key: string }>(
    `select f.id,f.storage_key from transfer_files f join transfers t on t.id=f.transfer_id
      where f.transfer_id=$1 and f.id=$2 and f.processing_generation=$3
        and t.deleted_at is null and t.expires_at > clock_timestamp()
      for update of f,t`,
    [target.transfer_id, target.file_id, target.generation],
  );
  if (!source.rows[0]) return false;
  const claim = await client.query<{ id: string }>(
    `select id from transfer_media_jobs
      where id=$1 and claim_token=$2 and status='claimed'
        and lease_until > clock_timestamp()
      for update`,
    [id, token],
  );
  if (!claim.rows[0]) return false;
  if (file?.previewStatus === "ready") {
    const outputs = await client.query<{ claim_token: string }>(
      `select claim_token from transfer_media_job_attempt_outputs
        where job_id=$1 and claim_token=$2`,
      [id, token],
    );
    if (!outputs.rows[0]) throw new Error("Transfer media claim outputs are unavailable");
  }
  if (
    file &&
    (file.id !== target.file_id ||
      file.storageKey !== source.rows[0].storage_key ||
      !file.processingStatus)
  )
    throw new Error("Transfer media result does not match claimed source");
  const rows = await client.query<{ id: string }>(
    `update transfer_media_jobs j
        set status='completed',claim_token=null,claim_owner=null,lease_until=null,
            completed_at=clock_timestamp(),last_error=null
      where j.id=$1 and j.claim_token=$2 and j.status='claimed'
        and j.lease_until > clock_timestamp()
      returning j.id`,
    [id, token],
  );
  if (rows.rowCount !== 1) return false;
  if (file) {
    await client.query(
      `update transfer_files
          set stored_bytes=coalesce($3,stored_bytes),width=$4,height=$5,taken_at=$6,
              live_photo_content_id=$7,preview_status=$8,processing_status=$9,
              processing_backend=$10,processing_route=$11,enqueued_at=$12,
              processing_started_at=$13,processing_completed_at=$14,
              processing_error_code=$15,processing_error_detail=$16,retry_count=$17,
              derivative_generation=case when $8='ready' then $18 else derivative_generation end,
              derivative_claim_token=case when $8='ready' then $19::uuid else derivative_claim_token end
        where transfer_id=$1 and id=$2`,
      [
        target.transfer_id,
        target.file_id,
        file.storedBytes ?? null,
        file.width ?? null,
        file.height ?? null,
        file.takenAt ?? null,
        file.livePhotoContentId ?? null,
        file.previewStatus ?? null,
        file.processingStatus,
        file.processingBackend ?? null,
        file.processingRoute ?? null,
        file.enqueuedAt ?? null,
        file.processingStartedAt ?? null,
        file.processingCompletedAt ?? null,
        file.processingErrorCode ?? null,
        file.processingErrorDetail ?? null,
        file.retryCount ?? null,
        target.generation,
        token,
      ],
    );
  }
  return true;
}

export async function failPostgresTransferMediaJob(
  id: string,
  token: string,
  errorCode: string,
  retryDelayMs: number,
): Promise<boolean> {
  if (
    !/^[a-z0-9_.-]{1,80}$/.test(errorCode) ||
    !Number.isInteger(retryDelayMs) ||
    retryDelayMs < 0 ||
    retryDelayMs > 60 * 60_000
  )
    throw new Error("Invalid transfer media failure");
  const rows = await query<{ id: string }>(
    `update transfer_media_jobs
        set status=case when attempts >= max_attempts then 'dead' else 'pending' end,
            available_at=clock_timestamp()+$4*interval '1 millisecond',
            claim_token=null,claim_owner=null,lease_until=null,last_error=$3
      where id=$1 and claim_token=$2 and status='claimed'
        and lease_until > clock_timestamp()
      returning id`,
    [id, token, errorCode, retryDelayMs],
  );
  return rows.length === 1;
}

export async function cancelClaimedPostgresTransferMediaJob(
  id: string,
  token: string,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update transfer_media_jobs
        set status='cancelled',claim_token=null,claim_owner=null,lease_until=null,
            last_error='source unavailable'
      where id=$1 and claim_token=$2 and status='claimed'
      returning id`,
    [id, token],
  );
  return rows.length === 1;
}

/** Invalidate work whose source was removed, expired or superseded. */
export async function cancelObsoletePostgresTransferMediaJobs(limit = 100): Promise<number> {
  const rows = await query<{ id: string }>(
    `with obsolete as (
       select j.id from transfer_media_jobs j
       left join transfers t on t.id=j.transfer_id
       left join transfer_files f on f.transfer_id=j.transfer_id and f.id=j.file_id
        where j.status in ('pending','claimed')
          and (t.id is null or t.deleted_at is not null or t.expires_at <= clock_timestamp()
               or f.id is null or f.processing_generation<>j.generation)
        order by j.enqueued_at,j.id
        limit $1 for update of j skip locked
     )
     update transfer_media_jobs j
        set status='cancelled',claim_token=null,claim_owner=null,lease_until=null
       from obsolete where j.id=obsolete.id
     returning j.id`,
    [Math.max(1, Math.min(limit, 500))],
  );
  return rows.length;
}
