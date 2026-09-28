import { createHash, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";

import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import { getUploadReservationTtlSeconds } from "./upload-window.server";
import { transferUploadFilesFingerprint } from "./upload-reservation.server";
import type { TransferUploadReservation } from "./upload-reservation.server";
import type { TransferUploadFileInput } from "./upload-types";

type ReservationRow = {
  transfer_id: string;
  delete_token_hash: string;
  actor_jti_hash: string;
  files_fingerprint_sha256: string;
  reserved_file_count: number;
  reserved_bytes: string;
  expires_seconds: number;
  created_at: Date;
  expires_at: Date;
};

export type PostgresTransferUploadReservation = {
  transferId: string;
  deleteTokenHash: string;
  actorJtiHash: string;
  filesFingerprintHash: string;
  reservedFileCount: number;
  reservedBytes: number;
  expiresSeconds: number;
  createdAt: string;
  expiresAt: string;
};

function toReservation(row: ReservationRow): PostgresTransferUploadReservation {
  return {
    transferId: row.transfer_id,
    deleteTokenHash: row.delete_token_hash,
    actorJtiHash: row.actor_jti_hash,
    filesFingerprintHash: row.files_fingerprint_sha256,
    reservedFileCount: row.reserved_file_count,
    reservedBytes: Number(row.reserved_bytes),
    expiresSeconds: row.expires_seconds,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

function fingerprint(kind: "delete" | "actor" | "files", value: string): string {
  return createHash("sha256")
    .update(`mah:transfer-reservation:${kind}:v1:`)
    .update(value)
    .digest("hex");
}

function equalHash(expected: string, actual: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}

function reservedBytes(files: TransferUploadFileInput[]): number {
  let total = 0;
  for (const file of files) {
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      (file.originalSize !== undefined &&
        (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0))
    )
      throw new Error("Invalid transfer reservation size");
    total += file.size + (file.originalSize ?? 0);
    if (!Number.isSafeInteger(total)) throw new Error("Invalid transfer reservation size");
  }
  return total;
}

/** Staged repository: callers must select it with the transfer store and cleanup path. */
export async function createPostgresTransferUploadReservation(
  reservation: TransferUploadReservation,
  files: TransferUploadFileInput[],
): Promise<boolean> {
  if (
    !reservation.transferId ||
    !reservation.deleteToken ||
    !reservation.actorJti ||
    files.length < 1 ||
    !Number.isInteger(reservation.expiresSeconds) ||
    reservation.expiresSeconds <= 0 ||
    reservation.filesFingerprint !== transferUploadFilesFingerprint(files)
  )
    throw new Error("Invalid transfer reservation");
  const bytes = reservedBytes(files);
  const createdAt = new Date(reservation.createdAt);
  if (!Number.isFinite(createdAt.getTime())) throw new Error("Invalid transfer reservation time");
  const ttlSeconds = getUploadReservationTtlSeconds();
  return transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,104729))", [
      reservation.transferId,
    ]);
    const inserted = await client.query<{ transfer_id: string }>(
      `insert into transfer_upload_reservations
       (transfer_id,delete_token_hash,actor_jti_hash,files_fingerprint_sha256,
        reserved_file_count,reserved_bytes,expires_seconds,created_at,expires_at)
     select $1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+$9*interval '1 second'
      where not exists (select 1 from transfers where id=$1)
        and not exists (
          select 1 from media_object_operations
           where owner_kind='transfer' and owner_id=$1 and operation='delete'
             and status <> 'completed'
        )
     on conflict (transfer_id) do nothing
     returning transfer_id`,
      [
        reservation.transferId,
        fingerprint("delete", reservation.deleteToken),
        fingerprint("actor", reservation.actorJti),
        fingerprint("files", reservation.filesFingerprint),
        files.length,
        bytes,
        reservation.expiresSeconds,
        createdAt,
        ttlSeconds,
      ],
    );
    return inserted.rowCount === 1;
  });
}

export async function getPostgresTransferUploadReservation(
  transferId: string,
): Promise<PostgresTransferUploadReservation | null> {
  const row = await queryOne<ReservationRow>(
    `select transfer_id,delete_token_hash,actor_jti_hash,files_fingerprint_sha256,
            reserved_file_count,reserved_bytes,expires_seconds,created_at,expires_at
       from transfer_upload_reservations
      where transfer_id=$1 and finalized_at is null and expires_at > clock_timestamp()`,
    [transferId],
  );
  return row ? toReservation(row) : null;
}

/** The finalization transaction owns this lock until transfer creation commits. */
export async function lockPostgresTransferUploadReservation(
  client: PoolClient,
  transferId: string,
): Promise<PostgresTransferUploadReservation | null> {
  const result = await client.query<ReservationRow>(
    `select transfer_id,delete_token_hash,actor_jti_hash,files_fingerprint_sha256,
            reserved_file_count,reserved_bytes,expires_seconds,created_at,expires_at
       from transfer_upload_reservations
      where transfer_id=$1 and finalized_at is null and expires_at > clock_timestamp()
      for update`,
    [transferId],
  );
  return result.rows[0] ? toReservation(result.rows[0]) : null;
}

export function matchesPostgresTransferUploadReservation(
  reservation: PostgresTransferUploadReservation,
  candidate: {
    deleteToken: string;
    actorJti: string;
    filesFingerprint?: string;
    expiresSeconds?: number;
  },
): boolean {
  return (
    equalHash(reservation.deleteTokenHash, fingerprint("delete", candidate.deleteToken)) &&
    equalHash(reservation.actorJtiHash, fingerprint("actor", candidate.actorJti)) &&
    (candidate.filesFingerprint === undefined ||
      equalHash(
        reservation.filesFingerprintHash,
        fingerprint("files", candidate.filesFingerprint),
      )) &&
    (candidate.expiresSeconds === undefined ||
      reservation.expiresSeconds === candidate.expiresSeconds)
  );
}

export async function deletePostgresTransferUploadReservation(transferId: string): Promise<void> {
  await query("delete from transfer_upload_reservations where transfer_id=$1", [transferId]);
}

export async function cleanupPostgresTransferUploadReservations(limit = 100): Promise<number> {
  const rows = await query<{ transfer_id: string }>(
    `with expired as (
       select transfer_id from transfer_upload_reservations
        where expires_at <= clock_timestamp()
        order by expires_at, transfer_id
        limit $1 for update skip locked
     )
     delete from transfer_upload_reservations r using expired
      where r.transfer_id=expired.transfer_id
     returning r.transfer_id`,
    [Math.max(1, Math.min(limit, 500))],
  );
  return rows.length;
}
