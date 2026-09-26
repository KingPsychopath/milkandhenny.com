import {
  claimMediaObjectOperations,
  completeMediaObjectOperation,
  failMediaObjectOperation,
} from "@/features/media/object-operations.server";
import { deleteObject } from "@/lib/platform/object-storage-provider-context.server";

export type TransferObjectDeletionBatch = {
  claimed: number;
  completed: number;
  retried: number;
  lostClaim: number;
};

/** R2 deletion is idempotent, so a retry after an uncertain response is safe. */
export async function runTransferObjectDeletionBatch(
  owner: string,
  limit = 10,
): Promise<TransferObjectDeletionBatch> {
  const claimed = await claimMediaObjectOperations(owner, limit, 5 * 60_000, "transfer");
  const result: TransferObjectDeletionBatch = {
    claimed: claimed.length,
    completed: 0,
    retried: 0,
    lostClaim: 0,
  };
  for (const operation of claimed) {
    try {
      if (operation.operation !== "delete" || operation.targetScope !== "private")
        throw new Error("Unexpected transfer object operation");
      await deleteObject(operation.targetKey, { scope: "private" });
      if (await completeMediaObjectOperation(operation.id, operation.claimToken))
        result.completed += 1;
      else result.lostClaim += 1;
    } catch {
      const delayMs = Math.min(60_000, 1_000 * 2 ** Math.min(operation.attempt - 1, 6));
      if (
        await failMediaObjectOperation(
          operation.id,
          operation.claimToken,
          "transfer_object_delete_failed",
          delayMs,
        )
      )
        result.retried += 1;
      else result.lostClaim += 1;
    }
  }
  return result;
}
