/**
 * Self-healing for media that never finished.
 *
 * Jobs get lost. A worker dies between claiming a job and finishing it, Redis
 * drops a queue under memory pressure, a deploy lands mid-flight, a derivative
 * gets deleted from object storage. Each leaves a file stuck: `queued` with no
 * job behind it, `processing` with no worker on it, or `ready` pointing at a
 * thumbnail that no longer exists.
 *
 * The repair already existed — `backfillTransferMedia` re-derives every file's
 * state from what is actually in object storage and requeues what is genuinely
 * unfinished — but nothing ever called it except an admin clicking a button.
 * This runs it on a schedule instead.
 */

import { mapConcurrent } from "@/features/media/processing.server";
import { getMediaProcessor } from "@/features/transfers/media-processor.server";
import {
  canRetryTransferProcessing,
  isTransferProcessingStale,
} from "@/features/transfers/media-state";
import { listTransferData } from "@/features/transfers/store.server";
import type { TransferData, TransferFile } from "@/features/transfers/types";
import { getRedis } from "@/lib/platform/redis.server";
import { log } from "@/lib/platform/logger.server";

const RECONCILE_LOCK_KEY = "transfer:media:reconcile-lock";
const RECONCILE_LOCK_TTL_SECONDS = 10 * 60;
const RECONCILE_CONCURRENCY = 2;

type ReconcileResult = {
  ran: boolean;
  reason?: "locked" | "no-transfers";
  transfersScanned: number;
  transfersRepaired: number;
  filesRepaired: number;
};

/**
 * Is this file waiting on something that is never going to arrive?
 *
 * Deliberately conservative — the point is to skip transfers that are fine
 * without touching object storage, not to diagnose the ones that are not.
 */
function fileNeedsAttention(file: TransferFile, nowMs: number): boolean {
  // Never classified: the upload recorded it but processing state is unknown.
  if (!file.previewStatus || !file.processingStatus) return true;

  // Claimed long ago and still not finished.
  if (isTransferProcessingStale(file, nowMs)) return true;

  // Failed, but the failure is one a retry could still fix.
  if (file.processingStatus === "failed" && canRetryTransferProcessing(file)) return true;

  return false;
}

function transferNeedsAttention(transfer: TransferData, nowMs: number): boolean {
  return transfer.files.some((file) => fileNeedsAttention(file, nowMs));
}

function countUnfinished(transfer: TransferData, nowMs: number): number {
  return transfer.files.filter((file) => fileNeedsAttention(file, nowMs)).length;
}

/**
 * Sweep every live transfer and repair whatever is stuck.
 *
 * Takes a Redis lock so replicas and the daily maintenance run cannot sweep on
 * top of each other — two backfills racing on the same transfer would each
 * write their own view of the file list.
 */
async function reconcileTransferMedia(
  options: { skipLock?: boolean } = {},
): Promise<ReconcileResult> {
  const empty: ReconcileResult = {
    ran: false,
    transfersScanned: 0,
    transfersRepaired: 0,
    filesRepaired: 0,
  };

  const redis = getRedis();
  if (!options.skipLock && redis) {
    const acquired = await redis.set(RECONCILE_LOCK_KEY, new Date().toISOString(), {
      ex: RECONCILE_LOCK_TTL_SECONDS,
      nx: true,
    });
    if (!acquired) return { ...empty, reason: "locked" };
  }

  try {
    // One pipelined read for every transfer, not one per transfer.
    const transfers = await listTransferData();
    if (transfers.length === 0) return { ...empty, ran: true, reason: "no-transfers" };

    const nowMs = Date.now();
    const stuck = transfers.filter((transfer) => transferNeedsAttention(transfer, nowMs));

    if (stuck.length === 0) {
      return { ...empty, ran: true, transfersScanned: transfers.length };
    }

    const processor = getMediaProcessor();
    let transfersRepaired = 0;
    let filesRepaired = 0;

    await mapConcurrent(stuck, RECONCILE_CONCURRENCY, async (transfer) => {
      const before = countUnfinished(transfer, nowMs);
      try {
        const updated = await processor.backfillTransferMedia(transfer);
        if (updated !== transfer) {
          transfersRepaired += 1;
          filesRepaired += Math.max(0, before - countUnfinished(updated, Date.now()));
        }
      } catch (error) {
        // One bad transfer must not abort the sweep for the rest.
        log.warn("transfer.media.reconcile", "Failed to reconcile transfer", {
          transferId: transfer.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    if (transfersRepaired > 0) {
      log.info("transfer.media.reconcile", "Repaired unfinished media", {
        transfersScanned: transfers.length,
        transfersRepaired,
        filesRepaired,
      });
    }

    return {
      ran: true,
      transfersScanned: transfers.length,
      transfersRepaired,
      filesRepaired,
    };
  } finally {
    if (!options.skipLock && redis) {
      await redis.del(RECONCILE_LOCK_KEY).catch(() => undefined);
    }
  }
}

export { reconcileTransferMedia, RECONCILE_LOCK_KEY };
export type { ReconcileResult };
