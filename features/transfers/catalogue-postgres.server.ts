import type { PoolClient } from "pg";

import { enqueueMediaObjectOperation } from "@/features/media/object-operations.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import { getTransferFileDeleteKeys } from "./delete";
import {
  decryptTransferDeleteToken,
  encryptTransferDeleteToken,
} from "./delete-token-postgres.server";
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
        processing_completed_at,processing_error_code,processing_error_detail,retry_count)
     select $1,id,position,filename,kind,size_bytes,stored_bytes,mime_type,storage_key,
            original_storage_key,original_filename,original_mime_type,converted_from,preview_source,
            width,height,taken_at,live_photo_content_id,preview_status,processing_status,
            processing_backend,processing_route,enqueued_at,processing_started_at,
            processing_completed_at,processing_error_code,processing_error_detail,retry_count
       from jsonb_to_recordset($2::jsonb) as f(
         id text, position integer, filename text, kind text, size_bytes bigint,
         stored_bytes bigint, mime_type text, storage_key text, original_storage_key text,
         original_filename text, original_mime_type text, converted_from text,
         preview_source text, width integer, height integer, taken_at timestamptz,
         live_photo_content_id text, preview_status text, processing_status text,
         processing_backend text, processing_route text, enqueued_at timestamptz,
         processing_started_at timestamptz, processing_completed_at timestamptz,
         processing_error_code text, processing_error_detail text, retry_count integer
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
    await client.query("delete from transfer_upload_reservations where transfer_id=$1", [data.id]);
    return "created";
  });
}

export type AppendPostgresTransferFilesResult =
  | { status: "updated"; transfer: TransferData }
  | { status: "missing" | "conflict" | "limit" };

/** Lock the owner row so two concurrent appends cannot both pass the same quota check. */
export async function appendPostgresTransferFiles(
  transferId: string,
  files: TransferFile[],
  limits: { maxFiles?: number; maxTotalBytes?: number } = {},
): Promise<AppendPostgresTransferFilesResult> {
  validateFiles(files);
  return transaction(async (client) => {
    const transfer = await client.query<{ id: string }>(
      `select id from transfers
        where id=$1 and deleted_at is null and expires_at > clock_timestamp()
        for update`,
      [transferId],
    );
    if (!transfer.rows[0]) return { status: "missing" };
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
    if (
      files.some(
        (file) =>
          ids.has(file.id) ||
          names.has(file.filename) ||
          (file.originalFilename ? names.has(file.originalFilename) : false),
      )
    )
      return { status: "conflict" };
    const maxFiles = limits.maxFiles ?? 0;
    const maxBytes = limits.maxTotalBytes ?? 0;
    const bytes =
      existing.rows.reduce((total, file) => total + Number(file.bytes), 0) +
      files.reduce((total, file) => total + (file.storedBytes ?? file.size), 0);
    if (
      !Number.isSafeInteger(bytes) ||
      (maxFiles > 0 && existing.rows.length + files.length > maxFiles) ||
      (maxBytes > 0 && bytes > maxBytes)
    )
      return { status: "limit" };
    await insertFiles(client, transferId, files, (existing.rows.at(-1)?.position ?? -1) + 1);
    await client.query("update transfers set revision=revision+1 where id=$1", [transferId]);
    const updated = await readTransfer(client, transferId, true, false);
    if (!updated) throw new Error("Transfer disappeared during append");
    return { status: "updated", transfer: updated };
  });
}

/** Reorder and regroup the current file set without replacing worker-owned file fields. */
export async function updatePostgresTransferGrouping(
  transferId: string,
  files: TransferFile[],
  groups: AssetGroup[] | undefined,
): Promise<boolean> {
  return transaction(async (client) => {
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
  });
}

/** Hide a transfer and fence its unfinished jobs before object cleanup begins. */
export async function tombstonePostgresTransfer(transferId: string): Promise<boolean> {
  return transaction(async (client) => {
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
    const files = await client.query<{
      id: string;
      filename: string;
      storage_key: string;
      original_storage_key: string | null;
      processing_route: TransferFile["processingRoute"] | null;
    }>(
      `select id,filename,storage_key,original_storage_key,processing_route
         from transfer_files where transfer_id=$1`,
      [transferId],
    );
    const keys = new Set(
      files.rows.flatMap((file) =>
        getTransferFileDeleteKeys(transferId, {
          id: file.id,
          filename: file.filename,
          storageKey: file.storage_key,
          originalStorageKey: file.original_storage_key ?? undefined,
          processingRoute: file.processing_route ?? undefined,
        }),
      ),
    );
    for (const key of keys)
      await enqueueMediaObjectOperation(client, {
        ownerKind: "transfer",
        ownerId: transferId,
        ownerRevision: revision,
        operation: "delete",
        targetScope: "private",
        targetKey: key,
      });
    await client.query(
      `update transfer_media_jobs
          set status='cancelled',claim_token=null,claim_owner=null,lease_until=null,
              last_error='transfer deleted'
        where transfer_id=$1 and status in ('pending','claimed')`,
      [transferId],
    );
    return true;
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
