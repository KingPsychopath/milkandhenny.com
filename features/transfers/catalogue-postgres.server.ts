import type { PoolClient } from "pg";

import { transaction } from "@/lib/platform/postgres.server";
import {
  decryptTransferDeleteToken,
  encryptTransferDeleteToken,
} from "./delete-token-postgres.server";
import type { AssetGroup, TransferData, TransferFile } from "./types";

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
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const file of data.files) {
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

async function insertFiles(client: PoolClient, data: TransferData): Promise<void> {
  if (data.files.length === 0) return;
  const rows = data.files.map((file, position) => ({
    ...file,
    position,
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
      data.id,
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

async function insertGroups(client: PoolClient, data: TransferData): Promise<void> {
  if (!data.groups?.length) return;
  await client.query(
    `insert into transfer_groups (transfer_id,id,type,captured_at)
     select $1,id,type,captured_at
       from jsonb_to_recordset($2::jsonb)
         as g(id text,type text,captured_at timestamptz)`,
    [
      data.id,
      JSON.stringify(
        data.groups.map((group) => ({
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
      data.id,
      JSON.stringify(
        data.groups.flatMap((group) =>
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

/** The transfer and its relational children become visible in one commit. */
export async function createPostgresTransfer(data: TransferData): Promise<boolean> {
  validateTransfer(data);
  const sealed = encryptTransferDeleteToken(data.id, data.deleteToken);
  return transaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `insert into transfers
         (id,title,owner_person_id,delete_token_hash,delete_token_ciphertext,
          delete_token_nonce,created_at,expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
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
      ],
    );
    if (!inserted.rows[0]) return false;
    await insertFiles(client, data);
    await insertGroups(client, data);
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
): Promise<TransferData | null>;
async function readTransfer(
  client: PoolClient,
  id: string,
  includeToken: false,
): Promise<Omit<TransferData, "deleteToken"> | null>;
async function readTransfer(
  client: PoolClient,
  id: string,
  includeToken: boolean,
): Promise<TransferData | Omit<TransferData, "deleteToken"> | null> {
  await client.query("set transaction isolation level repeatable read read only");
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
