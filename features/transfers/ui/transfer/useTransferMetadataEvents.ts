import { useCallback } from "react";
import { useVisibilityReconciler } from "@/hooks/useVisibilityReconciler";
import type { PublicTransferFile } from "@/features/transfers/public";
import { useTransferMediaEvents } from "./useTransferMediaEvents";

/** SSE is a wake. The current transfer read remains authoritative after reconnects and missed frames. */
export function useTransferMetadataEvents(params: {
  transferId: string;
  files: PublicTransferFile[];
  refresh: () => Promise<void>;
}) {
  const awaitingProcessing = params.files.some(
    (file) => file.processingStatus === "queued" || file.processingStatus === "processing",
  );
  const trigger = useVisibilityReconciler({
    enabled: awaitingProcessing,
    identity: params.transferId,
    intervalMs: 15_000,
    minimumGapMs: 1_500,
    reconcileOnEnable: false,
    reconcile: params.refresh,
  });
  const wake = useCallback(() => void trigger(), [trigger]);
  useTransferMediaEvents<PublicTransferFile>({
    transferId: params.transferId,
    enabled: awaitingProcessing,
    onFile: wake,
    onConnected: wake,
  });
}
