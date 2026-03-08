import "server-only";

import { getMediaProcessorMode } from "@/features/media/config";
import { createHybridMediaProcessor } from "@/features/media/backends/hybrid";
import { createLocalMediaProcessor } from "@/features/media/backends/local";
import type { TransferData } from "@/features/transfers/store";
import type { ProcessFileResult, TransferUploadFileInput } from "@/features/transfers/upload-types";

interface MediaProcessor {
  processTransferBuffer(
    buffer: Buffer,
    file: TransferUploadFileInput,
    transferId: string
  ): Promise<ProcessFileResult>;
  processTransferObject(
    file: TransferUploadFileInput,
    transferId: string
  ): Promise<ProcessFileResult>;
  backfillTransferMedia(transfer: TransferData): Promise<TransferData>;
}

const MEDIA_PROCESSOR_MODE = getMediaProcessorMode();

function getMediaProcessor(): MediaProcessor {
  if (MEDIA_PROCESSOR_MODE === "hybrid" || MEDIA_PROCESSOR_MODE === "worker") {
    return createHybridMediaProcessor(MEDIA_PROCESSOR_MODE);
  }
  if (MEDIA_PROCESSOR_MODE === "local") {
    return createLocalMediaProcessor();
  }

  throw new Error(
    `Unsupported MEDIA_PROCESSOR mode "${MEDIA_PROCESSOR_MODE}". Configure MEDIA_PROCESSOR_MODE=local|hybrid|worker.`
  );
}

export { getMediaProcessor };
export type { MediaProcessor };
