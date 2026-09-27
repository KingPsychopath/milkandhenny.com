import { query } from "@/lib/platform/postgres.server";
import { log } from "@/lib/platform/logger.server";
import { requeuePostgresTransferMediaFile } from "./media-reprocess-postgres.server";
import type { ReconcileResult } from "./media-reconcile.server";

const RECONCILE_BATCH_SIZE = 100;

/** A bounded sweep; each candidate is rechecked under its file row lock before enqueue. */
export async function reconcilePostgresTransferMedia(): Promise<ReconcileResult> {
  const counts = await query<{ transfers_scanned: string }>(
    `select count(*)::text as transfers_scanned from transfers
      where deleted_at is null and expires_at > clock_timestamp()`,
  );
  const transfersScanned = Number(counts[0]?.transfers_scanned ?? 0);
  if (transfersScanned === 0) {
    return {
      ran: true,
      reason: "no-transfers",
      transfersScanned: 0,
      transfersRepaired: 0,
      filesRepaired: 0,
    };
  }
  const candidates = await query<{ transfer_id: string; file_id: string }>(
    `select f.transfer_id,f.id as file_id
       from transfer_files f join transfers t on t.id=f.transfer_id
      where t.deleted_at is null and t.expires_at > clock_timestamp()
        and coalesce(f.retry_count,0) < 3
        and (
          (f.processing_status='failed'
            and coalesce(f.processing_error_code,'') not in ('raw_preview_unavailable','retries_exhausted'))
          or (f.processing_status in ('queued','processing')
            and coalesce(f.processing_started_at,f.enqueued_at) < clock_timestamp()-interval '15 minutes')
        )
        and not exists (
          select 1 from transfer_media_jobs j
           where j.transfer_id=f.transfer_id and j.file_id=f.id
             and j.generation=f.processing_generation
             and (j.status='pending' or (j.status='claimed' and j.lease_until > clock_timestamp()))
        )
      order by f.processing_status, f.enqueued_at nulls first, f.transfer_id, f.id
      limit $1`,
    [RECONCILE_BATCH_SIZE],
  );
  const repairedTransfers = new Set<string>();
  let filesRepaired = 0;
  for (const candidate of candidates) {
    try {
      const result = await requeuePostgresTransferMediaFile({
        transferId: candidate.transfer_id,
        fileId: candidate.file_id,
      });
      if (result === "requeued") {
        repairedTransfers.add(candidate.transfer_id);
        filesRepaired += 1;
      }
    } catch (error) {
      log.warn("transfer.media.reconcile", "Failed to reconcile Postgres transfer file", {
        transferId: candidate.transfer_id,
        fileId: candidate.file_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    ran: true,
    transfersScanned,
    transfersRepaired: repairedTransfers.size,
    filesRepaired,
  };
}
