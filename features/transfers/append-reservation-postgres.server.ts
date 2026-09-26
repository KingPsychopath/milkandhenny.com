import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

import { query, transaction } from "@/lib/platform/postgres.server";
import { getUploadReservationTtlSeconds } from "./upload-window.server";
import { transferUploadFilesFingerprint } from "./upload-reservation.server";
import type { TransferUploadFileInput } from "./upload-types";

export type AppendReservationResult = "reserved" | "missing" | "conflict" | "limit";

export function appendReservationFingerprint(files: TransferUploadFileInput[]): string {
  return createHash("sha256")
    .update("mah:transfer-append:v1:")
    .update(transferUploadFilesFingerprint(files))
    .digest("hex");
}

function selection(files: TransferUploadFileInput[]) {
  if (files.length < 1 || files.length > 500) throw new Error("Invalid append reservation files");
  const ids = files.map((file) => file.mediaId ?? file.name);
  const names = files.flatMap((file) =>
    file.originalName ? [file.name, file.originalName] : [file.name],
  );
  let bytes = 0;
  for (const file of files) {
    if (
      !file.name ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      (file.originalSize !== undefined &&
        (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0))
    )
      throw new Error("Invalid append reservation files");
    bytes += file.size + (file.originalSize ?? 0);
  }
  if (
    !Number.isSafeInteger(bytes) ||
    ids.some((id) => !id) ||
    new Set(ids).size !== ids.length ||
    new Set(names).size !== names.length
  )
    throw new Error("Invalid append reservation files");
  return { ids, names, bytes };
}

/** Lock the transfer while reserving quota across all outstanding append batches. */
export async function reservePostgresTransferAppend(
  transferId: string,
  files: TransferUploadFileInput[],
  limits: { maxFiles?: number; maxTotalBytes?: number } = {},
): Promise<AppendReservationResult> {
  const selected = selection(files);
  const fingerprint = appendReservationFingerprint(files);
  return transaction(async (client) => {
    const owner = await client.query<{ id: string }>(
      `select id from transfers
        where id=$1 and deleted_at is null and expires_at > clock_timestamp()
        for update`,
      [transferId],
    );
    if (!owner.rows[0]) return "missing";
    await client.query(
      "delete from transfer_append_reservations where transfer_id=$1 and expires_at <= clock_timestamp()",
      [transferId],
    );
    const same = await client.query<{ fingerprint_sha256: string }>(
      `select fingerprint_sha256 from transfer_append_reservations
        where transfer_id=$1 and fingerprint_sha256=$2`,
      [transferId, fingerprint],
    );
    if (same.rows[0]) return "reserved";
    const occupied = await client.query<{
      id: string;
      filename: string;
      original_filename: string | null;
      bytes: string;
    }>(
      `select id,filename,original_filename,coalesce(stored_bytes,size_bytes)::text as bytes
         from transfer_files where transfer_id=$1`,
      [transferId],
    );
    const pending = await client.query<{
      file_ids: string[];
      filenames: string[];
      reserved_file_count: number;
      reserved_bytes: string;
    }>(
      `select file_ids,filenames,reserved_file_count,reserved_bytes::text
         from transfer_append_reservations where transfer_id=$1`,
      [transferId],
    );
    const usedIds = new Set([
      ...occupied.rows.map((row) => row.id),
      ...pending.rows.flatMap((row) => row.file_ids),
    ]);
    const usedNames = new Set([
      ...occupied.rows.flatMap((row) =>
        row.original_filename ? [row.filename, row.original_filename] : [row.filename],
      ),
      ...pending.rows.flatMap((row) => row.filenames),
    ]);
    if (
      selected.ids.some((id) => usedIds.has(id)) ||
      selected.names.some((name) => usedNames.has(name))
    )
      return "conflict";
    const maxFiles = limits.maxFiles ?? 500;
    const count =
      occupied.rows.length +
      pending.rows.reduce((sum, row) => sum + row.reserved_file_count, 0) +
      files.length;
    const bytes =
      occupied.rows.reduce((sum, row) => sum + Number(row.bytes), 0) +
      pending.rows.reduce((sum, row) => sum + Number(row.reserved_bytes), 0) +
      selected.bytes;
    if (
      !Number.isSafeInteger(bytes) ||
      count > maxFiles ||
      (limits.maxTotalBytes !== undefined && bytes > limits.maxTotalBytes)
    )
      return "limit";
    await client.query(
      `insert into transfer_append_reservations
         (transfer_id,fingerprint_sha256,file_ids,filenames,reserved_file_count,
          reserved_bytes,expires_at)
       select $1,$2,$3::text[],$4::text[],$5,$6,
              least(expires_at,clock_timestamp()+$7*interval '1 second')
         from transfers where id=$1`,
      [
        transferId,
        fingerprint,
        selected.ids,
        selected.names,
        files.length,
        selected.bytes,
        getUploadReservationTtlSeconds(),
      ],
    );
    return "reserved";
  });
}

export async function cleanupPostgresTransferAppendReservations(limit = 100): Promise<number> {
  const rows = await query<{ transfer_id: string }>(
    `with expired as (
       select transfer_id,fingerprint_sha256 from transfer_append_reservations
        where expires_at <= clock_timestamp()
        order by expires_at,transfer_id,fingerprint_sha256
        limit $1 for update skip locked
     )
     delete from transfer_append_reservations r using expired
      where r.transfer_id=expired.transfer_id
        and r.fingerprint_sha256=expired.fingerprint_sha256
     returning r.transfer_id`,
    [Math.max(1, Math.min(limit, 500))],
  );
  return rows.length;
}

export async function lockPostgresTransferAppendReservation(
  client: PoolClient,
  transferId: string,
  files: TransferUploadFileInput[],
): Promise<{ reservedFileCount: number; reservedBytes: number } | null> {
  const row = await client.query<{ reserved_file_count: number; reserved_bytes: string }>(
    `select reserved_file_count,reserved_bytes::text
       from transfer_append_reservations
      where transfer_id=$1 and fingerprint_sha256=$2
        and expires_at > clock_timestamp()
      for update`,
    [transferId, appendReservationFingerprint(files)],
  );
  return row.rows[0]
    ? {
        reservedFileCount: row.rows[0].reserved_file_count,
        reservedBytes: Number(row.rows[0].reserved_bytes),
      }
    : null;
}
