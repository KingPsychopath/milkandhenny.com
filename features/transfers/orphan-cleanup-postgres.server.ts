import { enqueueMediaObjectOperation } from "@/features/media/object-operations.server";
import { transaction } from "@/lib/platform/postgres.server";
import { getTransferFileDeleteKeys } from "./delete";
import type { TransferFile } from "./types";

type ObservedObject = { key: string; lastModified?: Date };

/** Recheck database ownership under a row lock after the R2 listing is complete. */
export async function stagePostgresTransferOrphanObjects(
  transferId: string,
  observed: ObservedObject[],
  olderThan: Date,
): Promise<number> {
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(transferId) ||
    observed.length > 2_000 ||
    !Number.isFinite(olderThan.getTime())
  )
    throw new Error("Invalid transfer orphan scan");
  const prefix = `transfers/${transferId}/`;
  const stale = observed.filter(
    (object) =>
      object.key.startsWith(prefix) &&
      object.lastModified instanceof Date &&
      Number.isFinite(object.lastModified.getTime()) &&
      object.lastModified < olderThan,
  );
  if (stale.length === 0) return 0;

  return transaction(async (client) => {
    // This also serializes an absent owner with creation of a new presign reservation.
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,104729))", [transferId]);
    const owner = await client.query<{
      revision: string;
      deleted_at: Date | null;
      expires_at: Date;
    }>("select revision::text,deleted_at,expires_at from transfers where id=$1 for update", [
      transferId,
    ]);
    const transfer = owner.rows[0];
    if (transfer && !transfer.deleted_at && transfer.expires_at <= new Date()) return 0;
    const reservation = await client.query(
      `select 1 from transfer_upload_reservations
        where transfer_id=$1 and expires_at>clock_timestamp() for update`,
      [transferId],
    );
    if (reservation.rows[0]) return 0;
    const append = await client.query(
      `select 1 from transfer_append_reservations
        where transfer_id=$1 and expires_at>clock_timestamp() limit 1 for update`,
      [transferId],
    );
    if (append.rows[0]) return 0;
    const live = transfer && !transfer.deleted_at && transfer.expires_at > new Date();
    const known = new Set<string>();
    if (live) {
      const running = await client.query(
        `select 1 from transfer_media_jobs
          where transfer_id=$1 and status in ('pending','claimed') limit 1`,
        [transferId],
      );
      if (running.rows[0]) return 0;
      const files = await client.query<{
        id: string;
        filename: string;
        storage_key: string;
        original_storage_key: string | null;
        processing_route: TransferFile["processingRoute"] | null;
        derivative_generation: number | null;
        derivative_claim_token: string | null;
      }>(
        `select id,filename,storage_key,original_storage_key,processing_route,
                derivative_generation,derivative_claim_token
           from transfer_files where transfer_id=$1`,
        [transferId],
      );
      for (const file of files.rows)
        for (const key of getTransferFileDeleteKeys(transferId, {
          id: file.id,
          filename: file.filename,
          storageKey: file.storage_key,
          originalStorageKey: file.original_storage_key ?? undefined,
          processingRoute: file.processing_route ?? undefined,
          derivativeGeneration: file.derivative_generation ?? undefined,
          derivativeClaimToken: file.derivative_claim_token ?? undefined,
        }))
          known.add(key);
      const jobs = await client.query<{ thumb_key: string | null; full_key: string | null }>(
        `select payload->>'expectedThumbKey' as thumb_key,
                payload->>'expectedFullKey' as full_key
           from transfer_media_jobs where transfer_id=$1`,
        [transferId],
      );
      for (const job of jobs.rows)
        for (const key of [job.thumb_key, job.full_key]) if (key) known.add(key);
      const attempts = await client.query<{ thumb_key: string; full_key: string | null }>(
        `select o.thumb_key,o.full_key from transfer_media_job_attempt_outputs o
           join transfer_media_jobs j on j.id=o.job_id where j.transfer_id=$1`,
        [transferId],
      );
      for (const attempt of attempts.rows)
        for (const key of [attempt.thumb_key, attempt.full_key]) if (key) known.add(key);
    }
    const candidates = [...new Set(stale.map((object) => object.key))].filter(
      (key) => !known.has(key),
    );
    if (candidates.length === 0) return 0;
    const prior = await client.query<{ revision: string }>(
      `select coalesce(max(owner_revision),0)::text as revision
         from media_object_operations where owner_kind='transfer' and owner_id=$1`,
      [transferId],
    );
    const revision =
      Math.max(Number(transfer?.revision ?? 0), Number(prior.rows[0]?.revision ?? 0)) + 1;
    if (!Number.isSafeInteger(revision) || revision > 2_147_483_647)
      throw new Error("Transfer orphan deletion revision exceeds ledger range");
    if (transfer)
      await client.query("update transfers set revision=$2 where id=$1", [transferId, revision]);
    for (const key of candidates)
      await enqueueMediaObjectOperation(client, {
        ownerKind: "transfer",
        ownerId: transferId,
        ownerRevision: revision,
        operation: "delete",
        targetScope: "private",
        targetKey: key,
      });
    return candidates.length;
  });
}
