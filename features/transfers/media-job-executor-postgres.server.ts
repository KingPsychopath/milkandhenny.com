import path from "node:path";

import {
  processGifThumb,
  processImageVariants,
  processVideoVariantsFromSource,
  RawPreviewUnavailableError,
  resolveImageProcessingSource,
} from "@/features/media/processing.server";
import {
  deleteObjects,
  downloadBuffer,
  downloadToFile,
  uploadBuffer,
} from "@/lib/platform/object-storage-provider-context.server";
import { transaction } from "@/lib/platform/postgres.server";
import { getPostgresTransferForWorker } from "./catalogue-postgres.server";
import {
  cancelClaimedPostgresTransferMediaJob,
  claimPostgresTransferMediaJobs,
  completePostgresTransferMediaJob,
  failPostgresTransferMediaJob,
  renewPostgresTransferMediaJob,
  type ClaimedPostgresTransferMediaJob,
} from "./media-jobs-postgres.server";
import type { TransferFile } from "./types";

export type PostgresTransferMediaBatch = {
  claimed: number;
  completed: number;
  retried: number;
  obsolete: number;
  lostClaim: number;
};

function outputKeys(claim: ClaimedPostgresTransferMediaJob): string[] {
  return [claim.job.expectedThumbKey, claim.job.expectedFullKey].filter((key): key is string =>
    Boolean(key),
  );
}

async function processClaim(
  claim: ClaimedPostgresTransferMediaJob,
  signal?: AbortSignal,
): Promise<TransferFile | null> {
  signal?.throwIfAborted();
  const transfer = await getPostgresTransferForWorker(claim.job.transferId);
  const file = transfer?.files.find((entry) => entry.id === claim.job.mediaId);
  if (!file || file.storageKey !== claim.job.storageKey) return null;
  const thumbKey = claim.job.expectedThumbKey;
  const fullKey = claim.job.expectedFullKey;
  if (!thumbKey) throw new Error("Claimed transfer media job has no thumb output");
  const route = claim.job.processingRoute;
  let thumb: { buffer: Buffer; contentType: string };
  let full: { buffer: Buffer; contentType: string } | null = null;
  let width: number;
  let height: number;
  let takenAt = file.takenAt;
  let livePhotoContentId = file.livePhotoContentId;
  if (route === "worker_video") {
    const processed = await processVideoVariantsFromSource(
      path.extname(file.filename) || ".mp4",
      (destination) => downloadToFile(file.storageKey, destination, { scope: "private" }),
    );
    thumb = processed.thumb;
    full = processed.full;
    width = processed.width;
    height = processed.height;
    takenAt = processed.takenAt ?? takenAt;
    livePhotoContentId = processed.livePhotoContentId ?? livePhotoContentId;
  } else {
    const original = await downloadBuffer(file.storageKey, { scope: "private" });
    if (route === "worker_gif") {
      const processed = await processGifThumb(original);
      thumb = processed.thumb;
      width = processed.width;
      height = processed.height;
    } else if (route === "worker_raw" || route === "worker_image") {
      const source =
        route === "worker_raw"
          ? await resolveImageProcessingSource(
              original,
              path.extname(file.originalFilename ?? file.filename).toLowerCase() || ".dng",
            )
          : { buffer: original, takenAt: null };
      const processed = await processImageVariants(
        source.buffer,
        route === "worker_raw" ? ".jpg" : file.filename,
      );
      thumb = processed.thumb;
      full = processed.full;
      width = processed.width;
      height = processed.height;
      takenAt = processed.takenAt ?? source.takenAt ?? takenAt;
      livePhotoContentId = processed.livePhotoContentId ?? livePhotoContentId;
    } else {
      throw new Error("Unsupported Postgres transfer media route");
    }
  }
  if (Boolean(full) !== Boolean(fullKey))
    throw new Error("Claimed transfer media outputs do not match the processing route");
  signal?.throwIfAborted();
  await uploadBuffer(thumbKey, thumb.buffer, thumb.contentType, { scope: "private" });
  if (full && fullKey)
    await uploadBuffer(fullKey, full.buffer, full.contentType, { scope: "private" });
  signal?.throwIfAborted();
  return {
    ...file,
    width,
    height,
    ...(takenAt ? { takenAt } : {}),
    ...(livePhotoContentId ? { livePhotoContentId } : {}),
    ...(route === "worker_raw" ? { previewSource: "server_raw" as const } : {}),
    previewStatus: "ready",
    processingStatus: "worker_done",
    processingBackend: "worker",
    processingRoute: route,
    processingCompletedAt: new Date().toISOString(),
    processingErrorCode: undefined,
    processingErrorDetail: undefined,
    retryCount: claim.generation - 1,
  };
}

/** Claims are bounded; each attempt writes unique R2 keys and publishes only after DB fencing. */
export async function runPostgresTransferMediaBatch(
  owner: string,
  limit = 1,
  signal?: AbortSignal,
): Promise<PostgresTransferMediaBatch> {
  const claimed = await claimPostgresTransferMediaJobs(owner, limit);
  const result: PostgresTransferMediaBatch = {
    claimed: claimed.length,
    completed: 0,
    retried: 0,
    obsolete: 0,
    lostClaim: 0,
  };
  for (const claim of claimed) {
    const renew = setInterval(() => {
      if (signal?.aborted) return;
      void renewPostgresTransferMediaJob(claim.id, claim.claimToken).catch(() => undefined);
    }, 5 * 60_000);
    renew.unref?.();
    const stopRenewing = () => clearInterval(renew);
    signal?.addEventListener("abort", stopRenewing, { once: true });
    try {
      const file = await processClaim(claim, signal);
      if (!file) {
        if (await cancelClaimedPostgresTransferMediaJob(claim.id, claim.claimToken))
          result.obsolete += 1;
        else result.lostClaim += 1;
        continue;
      }
      if (
        await transaction((client) =>
          completePostgresTransferMediaJob(client, claim.id, claim.claimToken, file),
        )
      ) {
        result.completed += 1;
      } else {
        result.lostClaim += 1;
        await deleteObjects(outputKeys(claim), { scope: "private" }).catch(() => undefined);
      }
    } catch (error) {
      if (signal?.aborted) {
        await deleteObjects(outputKeys(claim), { scope: "private" }).catch(() => undefined);
        throw error;
      }
      if (error instanceof RawPreviewUnavailableError) {
        const transfer = await getPostgresTransferForWorker(claim.job.transferId);
        const file = transfer?.files.find((entry) => entry.id === claim.job.mediaId);
        if (
          file &&
          (await transaction((client) =>
            completePostgresTransferMediaJob(client, claim.id, claim.claimToken, {
              ...file,
              previewStatus: "original_only",
              processingStatus: "failed",
              processingErrorCode: "raw_preview_unavailable",
            }),
          ))
        ) {
          result.completed += 1;
          continue;
        }
      }
      const delayMs = Math.min(120_000, 15_000 * 2 ** Math.min(claim.job.deliveryAttempt ?? 0, 3));
      if (
        await failPostgresTransferMediaJob(
          claim.id,
          claim.claimToken,
          "worker_processing_failed",
          delayMs,
        )
      )
        result.retried += 1;
      else result.lostClaim += 1;
      await deleteObjects(outputKeys(claim), { scope: "private" }).catch(() => undefined);
    } finally {
      signal?.removeEventListener("abort", stopRenewing);
      clearInterval(renew);
    }
  }
  return result;
}
