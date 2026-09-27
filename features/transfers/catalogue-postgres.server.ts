import type { PoolClient } from "pg";

import { enqueueMediaObjectOperation } from "@/features/media/object-operations.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import { getTransferFileDeleteKeys } from "./delete";
import { inferTransferAssetGroups } from "./live-photo";
import {
  appendReservationFingerprint,
  lockPostgresTransferAppendReservation,
} from "./append-reservation-postgres.server";
import {
  decryptTransferDeleteToken,
  encryptTransferDeleteToken,
  verifyTransferDeleteToken,
} from "./delete-token-postgres.server";
import { enqueuePostgresTransferMediaJob } from "./media-jobs-postgres.server";
import type { TransferMediaJob } from "./media-queue.server";
import type { AssetGroup, TransferData, TransferFile, TransferSummary } from "./types";
import {
  lockPostgresTransferUploadReservation,
  matchesPostgresTransferUploadReservation,
} from "./upload-reservation-postgres.server";
import { transferUploadFilesFingerprint } from "./upload-reservation.server";
import type { TransferUploadFileInput } from "./upload-types";

type TransferRow = {
  id: string;
  title: string;
  owner_person_id: string | null;
  delete_token_ciphertext: Buffer | null;
  delete_token_nonce: Buffer | null;
  created_at: Date;
  expires_at: Date;
};

type FileRow = {
  id: string;
  filename: string;
  kind: TransferFile["kind"];
  size_bytes: string;
  stored_bytes: string | null;
  mime_type: string;
  storage_key: string;
  original_storage_key: string | null;
  original_filename: string | null;
  original_mime_type: string | null;
  converted_from: TransferFile["convertedFrom"] | null;
  preview_source: TransferFile["previewSource"] | null;
  width: number | null;
  height: number | null;
  taken_at: Date | null;
  live_photo_content_id: string | null;
  preview_status: TransferFile["previewStatus"] | null;
  processing_status: TransferFile["processingStatus"] | null;
  processing_backend: TransferFile["processingBackend"] | null;
  processing_route: TransferFile["processingRoute"] | null;
  enqueued_at: Date | null;
  processing_started_at: Date | null;
  processing_completed_at: Date | null;
  processing_error_code: string | null;
  processing_error_detail: string | null;
  retry_count: number | null;
  derivative_generation: number | null;
  derivative_claim_token: string | null;
};

type GroupRow = {
  id: string;
  type: AssetGroup["type"];
  captured_at: Date | null;
};

type MemberRow = {
  group_id: string;
  file_id: string;
  role: "primary" | "raw" | "motion";
  mime_type: string;
};

function validateFiles(files: TransferFile[]): void {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const file of files) {
    if (
      !file.id ||
      !file.filename ||
      !file.storageKey ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      (file.storedBytes !== undefined &&
        (!Number.isSafeInteger(file.storedBytes) || file.storedBytes < 0)) ||
      ids.has(file.id) ||
      names.has(file.filename) ||
      (file.originalFilename && names.has(file.originalFilename))
    )
      throw new Error("Invalid transfer file");
    ids.add(file.id);
    names.add(file.filename);
    if (file.originalFilename) names.add(file.originalFilename);
  }
}

function validateTransfer(data: TransferData): void {
  if (
    !data.id ||
    !data.deleteToken ||
    !data.title ||
    data.files.length > 500 ||
    !Number.isFinite(Date.parse(data.createdAt)) ||
    !Number.isFinite(Date.parse(data.expiresAt)) ||
    Date.parse(data.expiresAt) <= Date.parse(data.createdAt)
  )
    throw new Error("Invalid transfer");
  validateFiles(data.files);
  const assigned = new Set<string>();
  for (const group of data.groups ?? []) {
    if (!group.id || group.members.length < 2) throw new Error("Invalid transfer group");
    for (const member of group.members) {
      const file = data.files.find((entry) => entry.id === member.fileId);
      if (
        !file ||
        assigned.has(member.fileId) ||
        file.groupId !== group.id ||
        file.groupRole !== member.role
      )
        throw new Error("Invalid transfer group member");
      assigned.add(member.fileId);
    }
  }
  if (
    data.files.some(
      (file) =>
        Boolean(file.groupId) !== assigned.has(file.id) ||
        Boolean(file.groupId) !== Boolean(file.groupRole),
    )
  )
    throw new Error("Invalid transfer file group");
}

async function insertFiles(
  client: PoolClient,
  transferId: string,
  files: TransferFile[],
  startPosition = 0,
): Promise<void> {
  if (files.length === 0) return;
  const rows = files.map((file, index) => ({
    ...file,
    position: startPosition + index,
    sizeBytes: file.size,
    storedBytes: file.storedBytes ?? null,
  }));
  await client.query(
    `insert into transfer_files
       (transfer_id,id,position,filename,kind,size_bytes,stored_bytes,mime_type,storage_key,
        original_storage_key,original_filename,original_mime_type,converted_from,preview_source,
        width,height,taken_at,live_photo_content_id,preview_status,processing_status,
        processing_backend,processing_route,enqueued_at,processing_started_at,
        processing_completed_at,processing_error_code,processing_error_detail,retry_count,
        derivative_generation,derivative_claim_token)
     select $1,id,position,filename,kind,size_bytes,stored_bytes,mime_type,storage_key,
            original_storage_key,original_filename,original_mime_type,converted_from,preview_source,
            width,height,taken_at,live_photo_content_id,preview_status,processing_status,
            processing_backend,processing_route,enqueued_at,processing_started_at,
            processing_completed_at,processing_error_code,processing_error_detail,retry_count,
            derivative_generation,derivative_claim_token
       from jsonb_to_recordset($2::jsonb) as f(
         id text, position integer, filename text, kind text, size_bytes bigint,
         stored_bytes bigint, mime_type text, storage_key text, original_storage_key text,
         original_filename text, original_mime_type text, converted_from text,
         preview_source text, width integer, height integer, taken_at timestamptz,
         live_photo_content_id text, preview_status text, processing_status text,
         processing_backend text, processing_route text, enqueued_at timestamptz,
         processing_started_at timestamptz, processing_completed_at timestamptz,
         processing_error_code text, processing_error_detail text, retry_count integer,
         derivative_generation integer, derivative_claim_token uuid
       )`,
    [
      transferId,
      JSON.stringify(
        rows.map((file) => ({
          id: file.id,
          position: file.position,
          filename: file.filename,
          kind: file.kind,
          size_bytes: file.sizeBytes,
          stored_bytes: file.storedBytes,
          mime_type: file.mimeType,
          storage_key: file.storageKey,
          original_storage_key: file.originalStorageKey ?? null,
          original_filename: file.originalFilename ?? null,
          original_mime_type: file.originalMimeType ?? null,
          converted_from: file.convertedFrom ?? null,
          preview_source: file.previewSource ?? null,
          width: file.width ?? null,
          height: file.height ?? null,
          taken_at: file.takenAt ?? null,
          live_photo_content_id: file.livePhotoContentId ?? null,
          preview_status: file.previewStatus ?? null,
          processing_status: file.processingStatus ?? null,
          processing_backend: file.processingBackend ?? null,
          processing_route: file.processingRoute ?? null,
          enqueued_at: file.enqueuedAt ?? null,
          processing_started_at: file.processingStartedAt ?? null,
          processing_completed_at: file.processingCompletedAt ?? null,
          processing_error_code: file.processingErrorCode ?? null,
          processing_error_detail: file.processingErrorDetail ?? null,
          retry_count: file.retryCount ?? null,
          derivative_generation: file.derivativeGeneration ?? null,
          derivative_claim_token: file.derivativeClaimToken ?? null,
        })),
      ),
    ],
  );
}

async function insertGroups(
  client: PoolClient,
  transferId: string,
  groups: AssetGroup[] | undefined,
): Promise<void> {
  if (!groups?.length) return;
  await client.query(
    `insert into transfer_groups (transfer_id,id,type,captured_at)
     select $1,id,type,captured_at
       from jsonb_to_recordset($2::jsonb)
         as g(id text,type text,captured_at timestamptz)`,
    [
      transferId,
      JSON.stringify(
        groups.map((group) => ({
          id: group.id,
          type: group.type,
          captured_at: group.capturedAt ?? null,
        })),
      ),
    ],
  );
  await client.query(
    `insert into transfer_group_members (transfer_id,group_id,file_id,role,mime_type)
     select $1,group_id,file_id,role,mime_type
       from jsonb_to_recordset($2::jsonb)
         as m(group_id text,file_id text,role text,mime_type text)`,
    [
      transferId,
      JSON.stringify(
        groups.flatMap((group) =>
          group.members.map((member) => ({
            group_id: group.id,
            file_id: member.fileId,
            role: member.role,
            mime_type: member.mimeType,
          })),
        ),
      ),
    ],
  );
}

/** Call inside the import or upload transaction that owns related durable work. */
export async function createPostgresTransferInTransaction(
  client: PoolClient,
  data: TransferData,
  sourceRdbSha256?: string,
  sourcePayloadSha256?: string,
): Promise<boolean> {
  validateTransfer(data);
  if (sourceRdbSha256 && !/^[a-f0-9]{64}$/.test(sourceRdbSha256))
    throw new Error("Invalid transfer source fingerprint");
  if (sourcePayloadSha256 && !/^[a-f0-9]{64}$/.test(sourcePayloadSha256))
    throw new Error("Invalid transfer payload fingerprint");
  if (Boolean(sourceRdbSha256) !== Boolean(sourcePayloadSha256))
    throw new Error("Incomplete transfer source provenance");
  const sealed = encryptTransferDeleteToken(data.id, data.deleteToken);
  const inserted = await client.query<{ id: string }>(
    `insert into transfers
         (id,title,owner_person_id,delete_token_hash,delete_token_ciphertext,
          delete_token_nonce,created_at,expires_at,source_rdb_sha256,source_payload_sha256)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (id) do nothing returning id`,
    [
      data.id,
      data.title,
      data.ownerPersonId ?? null,
      sealed.hash,
      sealed.ciphertext,
      sealed.nonce,
      data.createdAt,
      data.expiresAt,
      sourceRdbSha256 ?? null,
      sourcePayloadSha256 ?? null,
    ],
  );
  if (!inserted.rows[0]) return false;
  await insertFiles(client, data.id, data.files);
  await insertGroups(client, data.id, data.groups);
  return true;
}

/** The transfer and its relational children become visible in one commit. */
export async function createPostgresTransfer(data: TransferData): Promise<boolean> {
  return transaction((client) => createPostgresTransferInTransaction(client, data));
}

export async function validatePostgresTransferDeleteToken(
  transferId: string,
  token: string,
): Promise<boolean> {
  if (!token) return false;
  const rows = await query<{ delete_token_hash: string }>(
    `select delete_token_hash from transfers
      where id=$1 and deleted_at is null and expires_at > clock_timestamp()`,
    [transferId],
  );
  return rows[0] ? verifyTransferDeleteToken(token, rows[0].delete_token_hash) : false;
}

async function enqueuePlannedMediaJobs(
  client: PoolClient,
  transferId: string,
  files: TransferFile[],
  jobs: TransferMediaJob[] | undefined,
): Promise<void> {
  const plannedJobs = jobs ?? [];
  const queued = new Map(
    files.filter((file) => file.processingStatus === "queued").map((file) => [file.id, file]),
  );
  if (queued.size !== plannedJobs.length) throw new Error("Incomplete transfer media job plan");
  const seen = new Set<string>();
  for (const job of plannedJobs) {
    const fileId = job.mediaId ?? job.file.mediaId ?? job.file.name;
    const file = queued.get(fileId);
    if (
      !file ||
      seen.has(fileId) ||
      job.transferId !== transferId ||
      job.file.name !== file.filename ||
      job.storageKey !== file.storageKey ||
      job.processingRoute !== file.processingRoute ||
      job.attempt !== 1
    )
      throw new Error("Transfer media job plan does not match its file");
    seen.add(fileId);
    await enqueuePostgresTransferMediaJob(client, job, 1);
  }
}

export type FinalizePostgresTransferResult =
  | "created"
  | "missing-reservation"
  | "reservation-mismatch"
  | "too-large"
  | "transfer-conflict";

/** Consume the presign claim and create its transfer as one durable handoff. */
export async function finalizePostgresTransferReservation(
  data: TransferData,
  actorJti: string,
  expiresSeconds: number,
  selectedFiles: TransferUploadFileInput[],
  mediaJobs?: TransferMediaJob[],
): Promise<FinalizePostgresTransferResult> {
  return transaction(async (client) => {
    const reservation = await lockPostgresTransferUploadReservation(client, data.id);
    if (!reservation) return "missing-reservation";
    if (
      !matchesPostgresTransferUploadReservation(reservation, {
        deleteToken: data.deleteToken,
        actorJti,
        expiresSeconds,
        filesFingerprint: transferUploadFilesFingerprint(selectedFiles),
      })
    )
      return "reservation-mismatch";
    const bytes = data.files.reduce((total, file) => total + (file.storedBytes ?? file.size), 0);
    const selectedIds = new Set(selectedFiles.map((file) => file.mediaId ?? file.name));
    if (
      data.files.length !== reservation.reservedFileCount ||
      selectedIds.size !== data.files.length ||
      data.files.some((file) => !selectedIds.has(file.id)) ||
      !Number.isSafeInteger(bytes) ||
      bytes > reservation.reservedBytes
    )
      return "too-large";
    if (!(await createPostgresTransferInTransaction(client, data))) return "transfer-conflict";
    await enqueuePlannedMediaJobs(client, data.id, data.files, mediaJobs);
    await client.query("delete from transfer_upload_reservations where transfer_id=$1", [data.id]);
    return "created";
  });
}

export type AppendPostgresTransferFilesResult =
  | { status: "updated"; transfer: TransferData }
  | { status: "missing" | "conflict" | "limit" };

/** Lock the owner row so two concurrent appends cannot both pass the same quota check. */
async function appendPostgresTransferFilesInTransaction(
  client: PoolClient,
  transferId: string,
  files: TransferFile[],
  limits: { maxFiles?: number; maxTotalBytes?: number },
  consumedReservation?: string,
): Promise<AppendPostgresTransferFilesResult> {
  validateFiles(files);
  const transfer = await client.query<{ id: string }>(
    `select id from transfers
        where id=$1 and deleted_at is null and expires_at > clock_timestamp()
        for update`,
    [transferId],
  );
  if (!transfer.rows[0]) return { status: "missing" };
  await client.query(
    "delete from transfer_append_reservations where transfer_id=$1 and expires_at <= clock_timestamp()",
    [transferId],
  );
  const existing = await client.query<{
    id: string;
    filename: string;
    original_filename: string | null;
    position: number;
    bytes: string;
  }>(
    `select id,filename,original_filename,position,
              coalesce(stored_bytes,size_bytes)::text as bytes
         from transfer_files where transfer_id=$1 order by position`,
    [transferId],
  );
  const ids = new Set(existing.rows.map((file) => file.id));
  const names = new Set(
    existing.rows.flatMap((file) =>
      [file.filename, file.original_filename].filter((name): name is string => name !== null),
    ),
  );
  const pending = await client.query<{
    file_ids: string[];
    filenames: string[];
    reserved_file_count: number;
    reserved_bytes: string;
  }>(
    `select file_ids,filenames,reserved_file_count,reserved_bytes::text
         from transfer_append_reservations
        where transfer_id=$1 and fingerprint_sha256 is distinct from $2`,
    [transferId, consumedReservation ?? null],
  );
  for (const reservation of pending.rows) {
    reservation.file_ids.forEach((id) => ids.add(id));
    reservation.filenames.forEach((name) => names.add(name));
  }
  if (
    files.some(
      (file) =>
        ids.has(file.id) ||
        names.has(file.filename) ||
        (file.originalFilename ? names.has(file.originalFilename) : false),
    )
  )
    return { status: "conflict" };
  const maxFiles = limits.maxFiles ?? 500;
  const bytes =
    existing.rows.reduce((total, file) => total + Number(file.bytes), 0) +
    pending.rows.reduce((total, row) => total + Number(row.reserved_bytes), 0) +
    files.reduce((total, file) => total + (file.storedBytes ?? file.size), 0);
  const count =
    existing.rows.length +
    pending.rows.reduce((total, row) => total + row.reserved_file_count, 0) +
    files.length;
  if (
    !Number.isSafeInteger(bytes) ||
    count > maxFiles ||
    (limits.maxTotalBytes !== undefined && bytes > limits.maxTotalBytes)
  )
    return { status: "limit" };
  await insertFiles(client, transferId, files, (existing.rows.at(-1)?.position ?? -1) + 1);
  await client.query("update transfers set revision=revision+1 where id=$1", [transferId]);
  const updated = await readTransfer(client, transferId, true, false);
  if (!updated) throw new Error("Transfer disappeared during append");
  return { status: "updated", transfer: updated };
}

export async function appendPostgresTransferFiles(
  transferId: string,
  files: TransferFile[],
  limits: { maxFiles?: number; maxTotalBytes?: number } = {},
): Promise<AppendPostgresTransferFilesResult> {
  return transaction((client) =>
    appendPostgresTransferFilesInTransaction(client, transferId, files, limits),
  );
}

export type FinalizePostgresTransferAppendResult =
  | AppendPostgresTransferFilesResult
  | { status: "missing-reservation" | "reservation-mismatch" };

/** Append the inspected objects and release their reserved quota in one commit. */
export async function finalizePostgresTransferAppend(
  transferId: string,
  selectedFiles: TransferUploadFileInput[],
  files: TransferFile[],
  limits: { maxFiles?: number; maxTotalBytes?: number } = {},
  mediaJobs?: TransferMediaJob[],
): Promise<FinalizePostgresTransferAppendResult> {
  return transaction(async (client) => {
    const transfer = await client.query<{ id: string }>(
      `select id from transfers
        where id=$1 and deleted_at is null and expires_at > clock_timestamp()
        for update`,
      [transferId],
    );
    if (!transfer.rows[0]) return { status: "missing" };
    const reservation = await lockPostgresTransferAppendReservation(
      client,
      transferId,
      selectedFiles,
    );
    if (!reservation) return { status: "missing-reservation" };
    const byId = new Map(
      selectedFiles.map((selected) => [selected.mediaId ?? selected.name, selected]),
    );
    const bytes = files.reduce((sum, file) => sum + (file.storedBytes ?? file.size), 0);
    if (
      files.length !== reservation.reservedFileCount ||
      byId.size !== files.length ||
      files.some((file) => {
        const selected = byId.get(file.id);
        return (
          !selected ||
          selected.name !== file.filename ||
          (selected.originalName ?? undefined) !== file.originalFilename
        );
      }) ||
      !Number.isSafeInteger(bytes) ||
      bytes > reservation.reservedBytes
    )
      return { status: "reservation-mismatch" };
    const result = await appendPostgresTransferFilesInTransaction(
      client,
      transferId,
      files,
      limits,
      appendReservationFingerprint(selectedFiles),
    );
    if (result.status !== "updated") return result;
    await enqueuePlannedMediaJobs(client, transferId, files, mediaJobs);
    const grouped = inferTransferAssetGroups(result.transfer.files);
    if (
      !(await updatePostgresTransferGroupingInTransaction(
        client,
        transferId,
        grouped.files,
        grouped.groups,
      ))
    )
      throw new Error("Transfer changed during append grouping");
    await client.query(
      "delete from transfer_append_reservations where transfer_id=$1 and fingerprint_sha256=$2",
      [transferId, appendReservationFingerprint(selectedFiles)],
    );
    const updated = await readTransfer(client, transferId, true, false);
    if (!updated) throw new Error("Transfer disappeared during append finalization");
    return { status: "updated", transfer: updated };
  });
}

/** Reorder and regroup the current file set without replacing worker-owned file fields. */
async function updatePostgresTransferGroupingInTransaction(
  client: PoolClient,
  transferId: string,
  files: TransferFile[],
  groups: AssetGroup[] | undefined,
): Promise<boolean> {
  const owner = await client.query<{ id: string }>(
    `select id from transfers
        where id=$1 and deleted_at is null and expires_at > clock_timestamp()
        for update`,
    [transferId],
  );
  if (!owner.rows[0]) return false;
  const current = await client.query<{ id: string; position: number }>(
    "select id,position from transfer_files where transfer_id=$1 order by position",
    [transferId],
  );
  const currentIds = new Set(current.rows.map((row) => row.id));
  if (
    currentIds.size !== files.length ||
    files.some((file) => !currentIds.has(file.id)) ||
    new Set(files.map((file) => file.id)).size !== files.length
  )
    return false;
  const assignments = new Map(
    files.map((file) => [file.id, { groupId: file.groupId, groupRole: file.groupRole }]),
  );
  const seenGroups = new Set<string>();
  const seenMembers = new Set<string>();
  for (const group of groups ?? []) {
    if (
      !group.id ||
      seenGroups.has(group.id) ||
      (group.type !== "live_photo" && group.type !== "raw_pair") ||
      group.members.length < 2
    )
      throw new Error("Invalid transfer group");
    seenGroups.add(group.id);
    for (const member of group.members) {
      const assignment = assignments.get(member.fileId);
      if (
        !assignment ||
        seenMembers.has(member.fileId) ||
        assignment.groupId !== group.id ||
        assignment.groupRole !== member.role
      )
        throw new Error("Invalid transfer group member");
      seenMembers.add(member.fileId);
    }
  }
  if (
    files.some(
      (file) =>
        Boolean(file.groupId) !== seenMembers.has(file.id) ||
        Boolean(file.groupId) !== Boolean(file.groupRole),
    )
  )
    throw new Error("Invalid transfer file group");

  // The temporary range avoids intermediate collisions with the unique position constraint.
  const offset = (current.rows.at(-1)?.position ?? -1) + files.length + 1;
  await client.query("update transfer_files set position=position+$2 where transfer_id=$1", [
    transferId,
    offset,
  ]);
  for (const [position, file] of files.entries()) {
    await client.query("update transfer_files set position=$3 where transfer_id=$1 and id=$2", [
      transferId,
      file.id,
      position,
    ]);
  }
  await client.query("delete from transfer_groups where transfer_id=$1", [transferId]);
  await insertGroups(client, transferId, groups);
  await client.query("update transfers set revision=revision+1 where id=$1", [transferId]);
  return true;
}

export async function updatePostgresTransferGrouping(
  transferId: string,
  files: TransferFile[],
  groups: AssetGroup[] | undefined,
): Promise<boolean> {
  return transaction((client) =>
    updatePostgresTransferGroupingInTransaction(client, transferId, files, groups),
  );
}

type TransferDeleteFileRow = {
  id: string;
  filename: string;
  storage_key: string;
  original_storage_key: string | null;
  processing_route: TransferFile["processingRoute"] | null;
  derivative_generation: number | null;
  derivative_claim_token: string | null;
};

async function stageTransferFileObjectDeletes(
  client: PoolClient,
  transferId: string,
  revision: number,
  files: TransferDeleteFileRow[],
  fileId?: string,
): Promise<void> {
  const keys = new Set(
    files.flatMap((file) =>
      getTransferFileDeleteKeys(transferId, {
        id: file.id,
        filename: file.filename,
        storageKey: file.storage_key,
        originalStorageKey: file.original_storage_key ?? undefined,
        processingRoute: file.processing_route ?? undefined,
        derivativeGeneration: file.derivative_generation ?? undefined,
        derivativeClaimToken: file.derivative_claim_token ?? undefined,
      }),
    ),
  );
  const params = fileId ? [transferId, fileId] : [transferId];
  const filter = fileId ? " and file_id=$2" : "";
  const jobs = await client.query<{ thumb_key: string | null; full_key: string | null }>(
    `select payload->>'expectedThumbKey' as thumb_key,
            payload->>'expectedFullKey' as full_key
       from transfer_media_jobs where transfer_id=$1${filter}`,
    params,
  );
  for (const job of jobs.rows)
    for (const key of [job.thumb_key, job.full_key])
      if (key?.startsWith(`transfers/${transferId}/`)) keys.add(key);
  const attempts = await client.query<{ thumb_key: string; full_key: string | null }>(
    `select o.thumb_key,o.full_key from transfer_media_job_attempt_outputs o
       join transfer_media_jobs j on j.id=o.job_id
      where j.transfer_id=$1${fileId ? " and j.file_id=$2" : ""}`,
    params,
  );
  for (const attempt of attempts.rows)
    for (const key of [attempt.thumb_key, attempt.full_key])
      if (key?.startsWith(`transfers/${transferId}/`)) keys.add(key);
  for (const key of keys)
    await enqueueMediaObjectOperation(client, {
      ownerKind: "transfer",
      ownerId: transferId,
      ownerRevision: revision,
      operation: "delete",
      targetScope: "private",
      targetKey: key,
    });
}

/** Hide a transfer and fence its unfinished jobs before object cleanup begins. */
async function tombstonePostgresTransferInTransaction(
  client: PoolClient,
  transferId: string,
): Promise<boolean> {
  const deleted = await client.query<{ revision: string }>(
    `update transfers
          set deleted_at=clock_timestamp(),revision=revision+1
        where id=$1 and deleted_at is null
        returning revision::text`,
    [transferId],
  );
  if (!deleted.rows[0]) return false;
  const revision = Number(deleted.rows[0].revision);
  if (!Number.isInteger(revision) || revision < 1 || revision > 2_147_483_647)
    throw new Error("Transfer deletion revision exceeds object ledger range");
  const files = await client.query<TransferDeleteFileRow>(
    `select id,filename,storage_key,original_storage_key,processing_route,
              derivative_generation,derivative_claim_token
         from transfer_files where transfer_id=$1`,
    [transferId],
  );
  await stageTransferFileObjectDeletes(client, transferId, revision, files.rows);
  await client.query(
    `update transfer_media_jobs
          set status='cancelled',claim_token=null,claim_owner=null,lease_until=null,
              last_error='transfer deleted'
        where transfer_id=$1 and status in ('pending','claimed')`,
    [transferId],
  );
  return true;
}

export async function tombstonePostgresTransfer(transferId: string): Promise<boolean> {
  return transaction((client) => tombstonePostgresTransferInTransaction(client, transferId));
}

/** Hard-reset the current catalogue in bounded transactions; R2 work stays durable in the ledger. */
export async function tombstoneAllPostgresTransfers(): Promise<{
  deletedTransfers: number;
  stagedFiles: number;
}> {
  const maximum = 1_000;
  const total = await query<{ count: string }>(
    "select count(*)::text as count from transfers where deleted_at is null",
  );
  if (Number(total[0]?.count ?? 0) > maximum)
    throw new Error("Transfer hard reset exceeds the 1,000-transfer safety bound");
  let deletedTransfers = 0;
  let stagedFiles = 0;
  while (true) {
    const batch = await transaction(async (client) => {
      const selected = await client.query<{ id: string; file_count: number }>(
        `select t.id,
                (select count(*)::integer from transfer_files f where f.transfer_id=t.id) as file_count
           from transfers t where t.deleted_at is null
          order by t.id limit 20 for update of t`,
      );
      for (const row of selected.rows) await tombstonePostgresTransferInTransaction(client, row.id);
      return {
        transfers: selected.rows.length,
        files: selected.rows.reduce((sum, row) => sum + row.file_count, 0),
      };
    });
    deletedTransfers += batch.transfers;
    stagedFiles += batch.files;
    if (batch.transfers === 0) return { deletedTransfers, stagedFiles };
    if (deletedTransfers > maximum)
      throw new Error("Transfer hard reset reached its safety bound; rerun after inspection");
  }
}

/** Expiry is a tombstone plus durable object work, never an implicit row disappearance. */
export async function cleanupExpiredPostgresTransfers(limit = 10): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new Error("Invalid transfer expiry cleanup limit");
  return transaction(async (client) => {
    const expired = await client.query<{ id: string }>(
      `select id from transfers
        where deleted_at is null and expires_at <= clock_timestamp()
        order by expires_at,id
        limit $1 for update skip locked`,
      [limit],
    );
    for (const row of expired.rows) await tombstonePostgresTransferInTransaction(client, row.id);
    return expired.rowCount ?? 0;
  });
}

/** Remove one file without losing another worker's result or leaving its R2 objects behind. */
export async function removePostgresTransferFile(
  transferId: string,
  fileId: string,
): Promise<"updated" | "deleted" | "missing" | "file-missing"> {
  return transaction(async (client) => {
    const owner = await client.query<{ revision: string }>(
      `select revision::text from transfers
        where id=$1 and deleted_at is null and expires_at > clock_timestamp()
        for update`,
      [transferId],
    );
    if (!owner.rows[0]) return "missing";
    const file = await client.query<TransferDeleteFileRow>(
      `select id,filename,storage_key,original_storage_key,processing_route,
              derivative_generation,derivative_claim_token
         from transfer_files where transfer_id=$1 and id=$2 for update`,
      [transferId, fileId],
    );
    const target = file.rows[0];
    if (!target) return "file-missing";
    const count = await client.query<{ count: string }>(
      "select count(*)::text as count from transfer_files where transfer_id=$1",
      [transferId],
    );
    if (count.rows[0]?.count === "1") {
      await tombstonePostgresTransferInTransaction(client, transferId);
      return "deleted";
    }
    const revision = Number(owner.rows[0].revision) + 1;
    if (!Number.isSafeInteger(revision) || revision > 2_147_483_647)
      throw new Error("Transfer file deletion revision exceeds object ledger range");
    await stageTransferFileObjectDeletes(client, transferId, revision, [target], fileId);
    const group = await client.query<{ group_id: string }>(
      `select group_id from transfer_group_members
        where transfer_id=$1 and file_id=$2`,
      [transferId, fileId],
    );
    await client.query("delete from transfer_files where transfer_id=$1 and id=$2", [
      transferId,
      fileId,
    ]);
    if (group.rows[0])
      await client.query(
        `delete from transfer_groups g
          where g.transfer_id=$1 and g.id=$2
            and (select count(*) from transfer_group_members m
                  where m.transfer_id=g.transfer_id and m.group_id=g.id)<2`,
        [transferId, group.rows[0].group_id],
      );
    await client.query("update transfers set revision=$2 where id=$1", [transferId, revision]);
    return "updated";
  });
}

function toFile(row: FileRow, member?: MemberRow): TransferFile {
  return {
    id: row.id,
    filename: row.filename,
    kind: row.kind,
    size: Number(row.size_bytes),
    ...(row.stored_bytes !== null ? { storedBytes: Number(row.stored_bytes) } : {}),
    mimeType: row.mime_type,
    storageKey: row.storage_key,
    ...(row.original_storage_key ? { originalStorageKey: row.original_storage_key } : {}),
    ...(row.original_filename ? { originalFilename: row.original_filename } : {}),
    ...(row.original_mime_type ? { originalMimeType: row.original_mime_type } : {}),
    ...(row.converted_from ? { convertedFrom: row.converted_from } : {}),
    ...(row.preview_source ? { previewSource: row.preview_source } : {}),
    ...(row.width !== null ? { width: row.width } : {}),
    ...(row.height !== null ? { height: row.height } : {}),
    ...(row.taken_at ? { takenAt: row.taken_at.toISOString() } : {}),
    ...(row.live_photo_content_id ? { livePhotoContentId: row.live_photo_content_id } : {}),
    ...(member ? { groupId: member.group_id, groupRole: member.role } : {}),
    ...(row.preview_status ? { previewStatus: row.preview_status } : {}),
    ...(row.processing_status ? { processingStatus: row.processing_status } : {}),
    ...(row.processing_backend ? { processingBackend: row.processing_backend } : {}),
    ...(row.processing_route ? { processingRoute: row.processing_route } : {}),
    ...(row.enqueued_at ? { enqueuedAt: row.enqueued_at.toISOString() } : {}),
    ...(row.processing_started_at
      ? { processingStartedAt: row.processing_started_at.toISOString() }
      : {}),
    ...(row.processing_completed_at
      ? { processingCompletedAt: row.processing_completed_at.toISOString() }
      : {}),
    ...(row.processing_error_code ? { processingErrorCode: row.processing_error_code } : {}),
    ...(row.processing_error_detail ? { processingErrorDetail: row.processing_error_detail } : {}),
    ...(row.retry_count !== null ? { retryCount: row.retry_count } : {}),
    ...(row.derivative_generation !== null
      ? { derivativeGeneration: row.derivative_generation }
      : {}),
    ...(row.derivative_claim_token !== null
      ? { derivativeClaimToken: row.derivative_claim_token }
      : {}),
  };
}

async function readTransfer(
  client: PoolClient,
  id: string,
  includeToken: true,
  snapshot?: boolean,
): Promise<TransferData | null>;
async function readTransfer(
  client: PoolClient,
  id: string,
  includeToken: false,
  snapshot?: boolean,
): Promise<Omit<TransferData, "deleteToken"> | null>;
async function readTransfer(
  client: PoolClient,
  id: string,
  includeToken: boolean,
  snapshot = true,
): Promise<TransferData | Omit<TransferData, "deleteToken"> | null> {
  if (snapshot) await client.query("set transaction isolation level repeatable read read only");
  const tokenColumns = includeToken
    ? "delete_token_ciphertext,delete_token_nonce"
    : "null::bytea as delete_token_ciphertext,null::bytea as delete_token_nonce";
  const transfer = await client.query<TransferRow>(
    `select id,title,owner_person_id,${tokenColumns},created_at,expires_at
       from transfers
      where id=$1 and deleted_at is null and expires_at > clock_timestamp()`,
    [id],
  );
  const row = transfer.rows[0];
  if (!row) return null;
  const files = await client.query<FileRow>(
    "select * from transfer_files where transfer_id=$1 order by position",
    [id],
  );
  const groups = await client.query<GroupRow>(
    "select id,type,captured_at from transfer_groups where transfer_id=$1 order by id",
    [id],
  );
  const members = await client.query<MemberRow>(
    `select group_id,file_id,role,mime_type
       from transfer_group_members where transfer_id=$1 order by group_id,file_id`,
    [id],
  );
  const membersByFile = new Map(members.rows.map((member) => [member.file_id, member]));
  const groupMembers = new Map<string, MemberRow[]>();
  for (const member of members.rows)
    groupMembers.set(member.group_id, [...(groupMembers.get(member.group_id) ?? []), member]);
  const result = {
    id: row.id,
    title: row.title,
    files: files.rows.map((file) => toFile(file, membersByFile.get(file.id))),
    ...(groups.rows.length
      ? {
          groups: groups.rows.map(
            (group): AssetGroup => ({
              id: group.id,
              type: group.type,
              ...(group.captured_at ? { capturedAt: group.captured_at.toISOString() } : {}),
              members: (groupMembers.get(group.id) ?? []).map((member) => ({
                fileId: member.file_id,
                role: member.role,
                mimeType: member.mime_type,
              })),
            }),
          ),
        }
      : {}),
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    ...(row.owner_person_id ? { ownerPersonId: row.owner_person_id } : {}),
  };
  if (!includeToken) return result;
  if (!row.delete_token_ciphertext || !row.delete_token_nonce)
    throw new Error("Transfer deletion token unavailable");
  return {
    ...result,
    deleteToken: decryptTransferDeleteToken(
      row.id,
      row.delete_token_ciphertext,
      row.delete_token_nonce,
    ),
  };
}

export async function getPostgresTransfer(id: string): Promise<TransferData | null> {
  return transaction((client) => readTransfer(client, id, true));
}

/** Worker reads need no web authentication or token-decryption secret. */
export async function getPostgresTransferForWorker(
  id: string,
): Promise<Omit<TransferData, "deleteToken"> | null> {
  return transaction((client) => readTransfer(client, id, false));
}

/** Admin and owner lists use one indexed query rather than reading each transfer body. */
export async function listPostgresTransferSummaries(
  ownerPersonId?: string,
): Promise<TransferSummary[]> {
  const rows = await query<{
    id: string;
    title: string;
    file_count: number;
    created_at: Date;
    expires_at: Date;
    remaining_seconds: number;
  }>(
    `select t.id,t.title,count(f.id)::integer as file_count,t.created_at,t.expires_at,
            greatest(0,floor(extract(epoch from (t.expires_at-clock_timestamp()))))::integer
              as remaining_seconds
       from transfers t left join transfer_files f on f.transfer_id=t.id
      where t.deleted_at is null and t.expires_at > clock_timestamp()
        and ($1::uuid is null or t.owner_person_id=$1)
      group by t.id
      order by t.created_at desc,t.id desc`,
    [ownerPersonId ?? null],
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    fileCount: row.file_count,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    remainingSeconds: row.remaining_seconds,
  }));
}
