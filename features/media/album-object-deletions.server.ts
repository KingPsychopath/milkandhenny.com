import {
  claimMediaObjectOperations,
  completeMediaObjectOperation,
  failMediaObjectOperation,
} from "./object-operations.server";
import { deleteObject } from "@/lib/platform/object-storage-provider-context.server";
import { queryOne } from "@/lib/platform/postgres.server";

export type AlbumObjectDeletionBatch = {
  claimed: number;
  completed: number;
  retried: number;
  lostClaim: number;
};

/** Public deletion follows a committed draft transition; publication waits for pending deletes. */
export async function runAlbumObjectDeletionBatch(
  owner: string,
  limit = 10,
): Promise<AlbumObjectDeletionBatch> {
  const claimed = await claimMediaObjectOperations(owner, limit, 5 * 60_000, "album");
  const result: AlbumObjectDeletionBatch = {
    claimed: claimed.length,
    completed: 0,
    retried: 0,
    lostClaim: 0,
  };
  for (const operation of claimed) {
    try {
      if (operation.operation !== "delete" || operation.targetScope !== "public")
        throw new Error("Unexpected album object operation");
      const album = await queryOne<{ status: "draft" | "published" }>(
        "select status from gallery_albums where slug=$1",
        [operation.ownerId],
      );
      if (album?.status === "published") throw new Error("Album is published again");
      await deleteObject(operation.targetKey, { scope: "public" });
      if (await completeMediaObjectOperation(operation.id, operation.claimToken))
        result.completed += 1;
      else result.lostClaim += 1;
    } catch {
      const delayMs = Math.min(60_000, 1_000 * 2 ** Math.min(operation.attempt - 1, 6));
      if (
        await failMediaObjectOperation(
          operation.id,
          operation.claimToken,
          "album_object_delete_failed",
          delayMs,
        )
      )
        result.retried += 1;
      else result.lostClaim += 1;
    }
  }
  return result;
}
