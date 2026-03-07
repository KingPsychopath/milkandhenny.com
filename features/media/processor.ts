import "server-only";

import { createHybridMediaProcessor } from "@/features/media/backends/hybrid";
import { createLocalMediaProcessor } from "@/features/media/backends/local";
import type { TransferData } from "@/features/transfers/store";
import type { ProcessFileResult, TransferUploadFileInput } from "@/features/transfers/upload-types";

interface MediaProcessor {
  processTransferBuffer(
    buffer: Buffer,
    filename: string,
    transferId: string
  ): Promise<ProcessFileResult>;
  processTransferObject(
    file: TransferUploadFileInput,
    transferId: string
  ): Promise<ProcessFileResult>;
  backfillTransferMedia(transfer: TransferData): Promise<TransferData>;
}

const MEDIA_PROCESSOR_BACKEND = process.env.MEDIA_PROCESSOR ?? "hybrid";

function getMediaProcessor(): MediaProcessor {
  if (MEDIA_PROCESSOR_BACKEND === "hybrid") {
    return createHybridMediaProcessor();
  }
  if (MEDIA_PROCESSOR_BACKEND === "local") {
    return createLocalMediaProcessor();
  }

  throw new Error(
    `Unsupported MEDIA_PROCESSOR backend "${MEDIA_PROCESSOR_BACKEND}". Configure MEDIA_PROCESSOR=hybrid or MEDIA_PROCESSOR=local.`
  );
}

export { getMediaProcessor };
export type { MediaProcessor };
