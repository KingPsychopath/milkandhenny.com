import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { PoolClient } from "pg";

import { createPostgresTransferInTransaction } from "@/features/transfers/catalogue-postgres.server";
import { decryptTransferDeleteToken } from "@/features/transfers/delete-token-postgres.server";
import type { TransferMediaJob } from "@/features/transfers/media-queue.server";
import type { TransferData } from "@/features/transfers/types";
import { closePool, transaction } from "@/lib/platform/postgres.server";

type Source = {
  rdbSha256: string;
  transfers: Array<{ id: string; value: TransferData; expiresAt?: string }>;
  indexedIds: string[];
  queued: unknown[];
  processing: unknown[];
  dead: unknown[];
};

type SourceList = "queued" | "processing" | "dead";

const ROUTES = new Set([
  "local_image",
  "local_gif",
  "local_video",
  "raw_try_local",
  "worker_raw",
  "worker_image",
  "worker_gif",
  "worker_video",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseSource(raw: unknown): Source {
  const root = object(raw);
  if (
    !root ||
    typeof root.rdbSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(root.rdbSha256) ||
    !Array.isArray(root.transfers) ||
    !Array.isArray(root.indexedIds) ||
    !Array.isArray(root.queued) ||
    !Array.isArray(root.processing) ||
    !Array.isArray(root.dead) ||
    root.indexedIds.some((id) => typeof id !== "string")
  )
    throw new Error("Invalid transfer source bundle");
  const transfers = root.transfers.map((item) => {
    const row = object(item);
    const value = object(row?.value);
    if (
      !row ||
      typeof row.id !== "string" ||
      !value ||
      value.id !== row.id ||
      typeof value.title !== "string" ||
      typeof value.deleteToken !== "string" ||
      typeof value.createdAt !== "string" ||
      typeof value.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      !Number.isFinite(Date.parse(value.expiresAt)) ||
      !Array.isArray(value.files) ||
      (row.expiresAt !== undefined &&
        (typeof row.expiresAt !== "string" ||
          !Number.isFinite(Date.parse(row.expiresAt)) ||
          Math.abs(Date.parse(row.expiresAt) - Date.parse(value.expiresAt)) > 1_000))
    )
      throw new Error("Invalid transfer record in source bundle");
    return {
      id: row.id,
      value: value as TransferData,
      expiresAt: row.expiresAt as string | undefined,
    };
  });
  if (new Set(transfers.map((row) => row.id)).size !== transfers.length)
    throw new Error("Duplicate transfer in source bundle");
  return {
    rdbSha256: root.rdbSha256,
    transfers,
    indexedIds: root.indexedIds as string[],
    queued: root.queued,
    processing: root.processing,
    dead: root.dead,
  };
}

function parseJob(raw: unknown): TransferMediaJob | null {
  const envelope = object(raw);
  const value = object(envelope?.job) ?? envelope;
  const file = object(value?.file);
  if (
    !value ||
    !file ||
    typeof value.transferId !== "string" ||
    typeof value.mediaId !== "string" ||
    !value.mediaId ||
    typeof value.storageKey !== "string" ||
    typeof value.mimeType !== "string" ||
    typeof value.processingRoute !== "string" ||
    !ROUTES.has(value.processingRoute) ||
    typeof value.idempotencyKey !== "string" ||
    !value.idempotencyKey ||
    typeof value.enqueuedAt !== "string" ||
    !Number.isFinite(Date.parse(value.enqueuedAt)) ||
    !Number.isInteger(value.attempt) ||
    Number(value.attempt) < 1 ||
    (value.deliveryAttempt !== undefined &&
      (!Number.isInteger(value.deliveryAttempt) || Number(value.deliveryAttempt) < 0)) ||
    typeof file.name !== "string"
  )
    return null;
  return value as TransferMediaJob;
}

async function quarantine(
  client: PoolClient,
  sourceHash: string,
  list: SourceList,
  index: number,
  raw: unknown,
  reason: string,
): Promise<void> {
  const payload = JSON.stringify(raw);
  const entryHash = sha256(payload);
  const inserted = await client.query<{ entry_sha256: string }>(
    `insert into legacy_archive.transfer_media_job_quarantine
       (source_rdb_sha256,source_list,source_index,entry_sha256,reason,payload)
     values ($1,$2,$3,$4,$5,$6::jsonb)
     on conflict (source_rdb_sha256,source_list,source_index) do nothing
     returning entry_sha256`,
    [sourceHash, list, index, entryHash, reason, payload],
  );
  if (inserted.rows[0]) return;
  const existing = await client.query<{ entry_sha256: string; reason: string }>(
    `select entry_sha256,reason from legacy_archive.transfer_media_job_quarantine
       where source_rdb_sha256=$1 and source_list=$2 and source_index=$3`,
    [sourceHash, list, index],
  );
  if (existing.rows[0]?.entry_sha256 !== entryHash || existing.rows[0]?.reason !== reason)
    throw new Error("Conflicting transfer media quarantine entry");
}

async function importTransfer(
  client: PoolClient,
  row: Source["transfers"][number],
  sourceHash: string,
): Promise<void> {
  const payloadHash = sha256(JSON.stringify(row.value));
  const created = await createPostgresTransferInTransaction(
    client,
    row.value,
    sourceHash,
    payloadHash,
  );
  if (created) return;
  const existing = await client.query<{
    source_rdb_sha256: string | null;
    source_payload_sha256: string | null;
    delete_token_ciphertext: Buffer;
    delete_token_nonce: Buffer;
  }>(
    `select source_rdb_sha256,source_payload_sha256,
            delete_token_ciphertext,delete_token_nonce
       from transfers where id=$1 for update`,
    [row.id],
  );
  const match = existing.rows[0];
  if (
    match?.source_rdb_sha256 !== sourceHash ||
    match?.source_payload_sha256 !== payloadHash ||
    decryptTransferDeleteToken(row.id, match.delete_token_ciphertext, match.delete_token_nonce) !==
      row.value.deleteToken
  )
    throw new Error("Conflicting imported transfer");
}

async function importJob(
  client: PoolClient,
  source: Source,
  sourceHash: string,
  list: SourceList,
  index: number,
  raw: unknown,
): Promise<"job" | "quarantine"> {
  const job = parseJob(raw);
  if (!job) {
    await quarantine(client, sourceHash, list, index, raw, "invalid_job");
    return "quarantine";
  }
  const transfer = source.transfers.find((row) => row.id === job.transferId)?.value;
  if (!transfer) {
    await quarantine(client, sourceHash, list, index, raw, "missing_transfer");
    return "quarantine";
  }
  const file = transfer.files.find((item) => item.id === job.mediaId);
  if (!file) {
    await quarantine(client, sourceHash, list, index, raw, "missing_file");
    return "quarantine";
  }
  if (file.storageKey !== job.storageKey) {
    await quarantine(client, sourceHash, list, index, raw, "source_key_mismatch");
    return "quarantine";
  }
  const delivery = job.deliveryAttempt ?? 0;
  const attempts = delivery + (list === "processing" ? 1 : 0);
  const completed =
    file.processingStatus === "worker_done" || file.processingStatus === "local_done";
  const terminal = file.processingStatus === "failed" || file.processingStatus === "skipped";
  const status = completed ? "completed" : terminal || list === "dead" ? "dead" : "pending";
  const entryHash = sha256(JSON.stringify(raw));
  const id = [
    entryHash.slice(0, 8),
    entryHash.slice(8, 12),
    entryHash.slice(12, 16),
    entryHash.slice(16, 20),
    entryHash.slice(20, 32),
  ].join("-");
  const inserted = await client.query<{ id: string }>(
    `insert into transfer_media_jobs
       (id,transfer_id,file_id,operation,generation,idempotency_key,payload,status,
        available_at,enqueued_at,attempts,max_attempts,completed_at,source_rdb_sha256,
        source_list,source_index,source_entry_sha256)
     values ($1,$2,$3,'process',$4,$5,$6::jsonb,$7,clock_timestamp(),$8,$9,$10,$11,$12,$13,$14,$15)
     on conflict (transfer_id,file_id,operation,generation) do nothing returning id`,
    [
      id,
      job.transferId,
      job.mediaId,
      job.attempt,
      job.idempotencyKey,
      JSON.stringify(job),
      status,
      job.enqueuedAt,
      attempts,
      Math.max(5, attempts),
      completed ? (file.processingCompletedAt ?? null) : null,
      sourceHash,
      list,
      index,
      entryHash,
    ],
  );
  if (inserted.rows[0]) return "job";
  const existing = await client.query<{
    source_rdb_sha256: string | null;
    idempotency_key: string;
    payload_matches: boolean;
    source_list: string | null;
    source_index: number | null;
    source_entry_sha256: string | null;
  }>(
    `select source_rdb_sha256,idempotency_key,payload=$4::jsonb as payload_matches,
            source_list,source_index,source_entry_sha256
       from transfer_media_jobs
      where transfer_id=$1 and file_id=$2 and operation='process' and generation=$3`,
    [job.transferId, job.mediaId, job.attempt, JSON.stringify(job)],
  );
  if (
    existing.rows[0]?.source_rdb_sha256 !== sourceHash ||
    existing.rows[0]?.idempotency_key !== job.idempotencyKey ||
    !existing.rows[0]?.payload_matches ||
    existing.rows[0]?.source_list !== list ||
    existing.rows[0]?.source_index !== index ||
    existing.rows[0]?.source_entry_sha256 !== entryHash
  )
    throw new Error("Conflicting imported transfer media job");
  return "job";
}

async function main() {
  const [path, sourceHash] = process.argv.slice(2);
  if (!path || !/^[a-f0-9]{64}$/.test(sourceHash ?? ""))
    throw new Error(
      "Usage: tsx ops/import-legacy-transfers.ts <private-transfer-json> <rdb-sha256>",
    );
  const info = await stat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0)
    throw new Error("Transfer source file must be private");
  const source = parseSource(JSON.parse(await readFile(path, "utf8")) as unknown);
  if (source.rdbSha256 !== sourceHash) throw new Error("Transfer source hash does not match RDB");
  let importedJobs = 0;
  let quarantinedJobs = 0;
  await transaction(async (client) => {
    for (const row of source.transfers) await importTransfer(client, row, sourceHash);
    const generations = new Map<
      string,
      { transferId: string; fileId: string; generation: number }
    >();
    for (const list of ["queued", "processing", "dead"] as const) {
      for (const raw of source[list]) {
        const job = parseJob(raw);
        if (!job?.mediaId) continue;
        const transfer = source.transfers.find((row) => row.id === job.transferId)?.value;
        const file = transfer?.files.find((item) => item.id === job.mediaId);
        if (!file || file.storageKey !== job.storageKey) continue;
        const key = job.transferId + ":" + job.mediaId;
        const prior = generations.get(key);
        if (!prior || job.attempt > prior.generation)
          generations.set(key, {
            transferId: job.transferId,
            fileId: job.mediaId,
            generation: job.attempt,
          });
      }
    }
    for (const entry of generations.values())
      await client.query(
        `update transfer_files
            set processing_generation=greatest(processing_generation,$3)
          where transfer_id=$1 and id=$2`,
        [entry.transferId, entry.fileId, entry.generation],
      );
    for (const list of ["queued", "processing", "dead"] as const) {
      for (const [index, raw] of source[list].entries()) {
        const outcome = await importJob(client, source, sourceHash, list, index, raw);
        if (outcome === "job") importedJobs += 1;
        else quarantinedJobs += 1;
      }
    }
  });
  console.log(
    "transfers=" +
      source.transfers.length +
      " imported_jobs=" +
      importedJobs +
      " quarantined_jobs=" +
      quarantinedJobs +
      " indexed_ids=" +
      source.indexedIds.length,
  );
  await closePool();
}

main().catch(async (error) => {
  await closePool().catch(() => undefined);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
