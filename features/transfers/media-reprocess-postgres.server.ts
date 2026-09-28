import { transaction } from "@/lib/platform/postgres.server";
import {
  canRetryTransferProcessing,
  getGenerationTransferAssetKeys,
  isTransferProcessingStale,
} from "./media-state";
import { enqueuePostgresTransferMediaJob } from "./media-jobs-postgres.server";
import { postgresWorkerRouteForFilename } from "./media-plan-postgres.server";
import type { TransferMediaJob } from "./media-queue.server";
import type { TransferFile } from "./types";

type SourceRow = {
  id: string;
  filename: string;
  size_bytes: string;
  mime_type: string;
  storage_key: string;
  original_filename: string | null;
  original_mime_type: string | null;
  converted_from: TransferFile["convertedFrom"] | null;
  processing_status: TransferFile["processingStatus"] | null;
  processing_error_code: string | null;
  processing_generation: number;
  retry_count: number | null;
  enqueued_at: Date | null;
  processing_started_at: Date | null;
};

/** Advance the source generation and enqueue exactly one replacement job in the same commit. */
export async function requeuePostgresTransferMediaFile(input: {
  transferId: string;
  fileId: string;
  force?: boolean;
}): Promise<"missing" | "skipped" | "requeued"> {
  return transaction(async (client) => {
    const selected = await client.query<SourceRow>(
      `select f.id,f.filename,f.size_bytes::text,f.mime_type,f.storage_key,
              f.original_filename,f.original_mime_type,f.converted_from,
              f.processing_status,f.processing_error_code,f.processing_generation,
              f.retry_count,f.enqueued_at,f.processing_started_at
         from transfers t join transfer_files f on f.transfer_id=t.id
        where t.id=$1 and f.id=$2 and t.deleted_at is null
          and t.expires_at > clock_timestamp()
        for update of t,f`,
      [input.transferId, input.fileId],
    );
    const file = selected.rows[0];
    if (!file) return "missing";
    const route = postgresWorkerRouteForFilename(file.filename);
    if (!route) return "skipped";
    const status = file.processing_status ?? undefined;
    if (!input.force) {
      if (
        !canRetryTransferProcessing({
          processingStatus: status,
          processingErrorCode: file.processing_error_code ?? undefined,
          retryCount: file.retry_count ?? undefined,
        })
      )
        return "skipped";
      if (
        (status === "queued" || status === "processing") &&
        !isTransferProcessingStale({
          processingStatus: status,
          enqueuedAt: file.enqueued_at?.toISOString(),
          processingStartedAt: file.processing_started_at?.toISOString(),
        })
      )
        return "skipped";
      const activeJob = await client.query<{ exists: boolean }>(
        `select exists(
           select 1 from transfer_media_jobs
            where transfer_id=$1 and file_id=$2 and generation=$3
              and (status='pending' or (status='claimed' and lease_until > clock_timestamp()))
         ) as exists`,
        [input.transferId, file.id, file.processing_generation],
      );
      if (activeJob.rows[0]?.exists) return "skipped";
    }
    const generation = file.processing_generation + 1;
    if (!Number.isSafeInteger(generation)) throw new Error("Transfer media generation exhausted");
    const size = Number(file.size_bytes);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid transfer media size");
    const enqueuedAt = new Date().toISOString();
    const expected = getGenerationTransferAssetKeys(
      input.transferId,
      file.filename,
      route,
      file.id,
      generation,
    );
    const job: TransferMediaJob = {
      transferId: input.transferId,
      file: {
        name: file.filename,
        mediaId: file.id,
        size,
        type: file.mime_type,
        ...(file.original_filename ? { originalName: file.original_filename } : {}),
        ...(file.original_mime_type ? { originalType: file.original_mime_type } : {}),
        ...(file.converted_from ? { convertedFrom: file.converted_from } : {}),
      },
      mediaId: file.id,
      storageKey: file.storage_key,
      expectedThumbKey: expected.thumbKey,
      expectedFullKey: expected.fullKey,
      mimeType: file.mime_type,
      processingRoute: route,
      attempt: generation,
      enqueuedAt,
    };
    await client.query(
      `update transfer_files
          set processing_generation=$3,preview_status='original_only',
              processing_status='queued',processing_backend='worker',processing_route=$4,
              enqueued_at=$5,processing_started_at=null,processing_completed_at=null,
              processing_error_code=null,processing_error_detail=null,retry_count=$6,
              derivative_generation=null,derivative_claim_token=null
        where transfer_id=$1 and id=$2`,
      [input.transferId, file.id, generation, route, enqueuedAt, (file.retry_count ?? 0) + 1],
    );
    await client.query(
      `update transfer_media_jobs
          set status='cancelled',claim_token=null,claim_owner=null,lease_until=null
        where transfer_id=$1 and file_id=$2 and generation<$3
          and status in ('pending','claimed')`,
      [input.transferId, file.id, generation],
    );
    await enqueuePostgresTransferMediaJob(client, job, generation);
    return "requeued";
  });
}
