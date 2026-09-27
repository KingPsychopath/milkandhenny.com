import { deleteObject } from "@/lib/platform/object-storage-provider-context.server";
import { transaction } from "@/lib/platform/postgres.server";
import {
  claimMediaObjectOperations,
  failMediaObjectOperation,
} from "@/features/media/object-operations.server";

/** A deleted slug cannot be reused until every deletion settles. The same advisory
 * lock serializes deletion, retry, and any later create using that slug. */
export async function runWordMediaDeletionBatch(owner: string, limit = 10) {
  const claimed = await claimMediaObjectOperations(owner, limit, 5 * 60_000, "word");
  const result = { claimed: claimed.length, completed: 0, retried: 0, lostClaim: 0 };
  for (const operation of claimed) {
    try {
      const completed = await transaction(async (client) => {
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `word:${operation.ownerId}`,
        ]);
        const claim = await client.query(
          `select 1 from media_object_operations
             where id=$1 and claim_token=$2 and status='claimed' and lease_until>now()`,
          [operation.id, operation.claimToken],
        );
        if (!claim.rows[0]) return false;
        const current = await client.query("select 1 from words where slug=$1", [
          operation.ownerId,
        ]);
        if (current.rows[0]) throw new Error("Word slug was reused before media cleanup");
        if (
          operation.operation !== "delete" ||
          !operation.targetKey.startsWith(`words/media/${operation.ownerId}/`)
        )
          throw new Error("Invalid word media deletion");
        await deleteObject(operation.targetKey, { scope: operation.targetScope });
        const settled = await client.query(
          `update media_object_operations
              set status='completed', claim_token=null, claim_owner=null, lease_until=null,
                  completed_at=now(), updated_at=now(), last_error=null
            where id=$1 and claim_token=$2 and status='claimed' and lease_until>now()
            returning id`,
          [operation.id, operation.claimToken],
        );
        return settled.rowCount === 1;
      });
      if (completed) result.completed += 1;
      else result.lostClaim += 1;
    } catch {
      const delayMs = Math.min(60_000, 1_000 * 2 ** Math.min(operation.attempt - 1, 6));
      if (
        await failMediaObjectOperation(
          operation.id,
          operation.claimToken,
          "word_media_delete_failed",
          delayMs,
        )
      )
        result.retried += 1;
      else result.lostClaim += 1;
    }
  }
  return result;
}
