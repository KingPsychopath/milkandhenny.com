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

const MEDIA_PROCESSOR = (() => {
  const mode = getMediaProcessorMode();
  if (mode === "local") return createLocalMediaProcessor();
  return createHybridMediaProcessor(mode);
})();

function getMediaProcessor(): MediaProcessor {
  return MEDIA_PROCESSOR;
}

export { getMediaProcessor };
export type { MediaProcessor };
