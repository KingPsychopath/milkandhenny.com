import { claimMediaObjectOperations, failMediaObjectOperation } from "./object-operations.server";
import { deleteObject } from "@/lib/platform/object-storage-provider-context.server";
import { transaction } from "@/lib/platform/postgres.server";
import { privatePhotoKeys, publicPhotoKeys } from "./album-object-keys";

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
      if (operation.operation !== "delete") throw new Error("Unexpected album object operation");
      const completed = await transaction(async (client) => {
        // Hold the same lock as album writes across the external deletion. A worker that
        // resumes after its lease expires cannot erase a key republished by a newer revision.
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `album:${operation.ownerId}`,
        ]);
        const current = await client.query<{ status: "draft" | "published" }>(
          "select status from gallery_albums where slug=$1",
          [operation.ownerId],
        );
        const photos = await client.query<{ photo_id: string; widths: number[] }>(
          "select photo_id,widths from gallery_album_photos where album_slug=$1",
          [operation.ownerId],
        );
        const referenced = new Set(
          photos.rows.flatMap((photo) =>
            operation.targetScope === "private"
              ? privatePhotoKeys(operation.ownerId, { id: photo.photo_id, widths: photo.widths })
              : publicPhotoKeys(operation.ownerId, { id: photo.photo_id, widths: photo.widths }),
          ),
        );
        if (
          referenced.has(operation.targetKey) &&
          (operation.targetScope === "private" || current.rows[0]?.status === "published")
        )
          throw new Error("Album object is referenced");
        const claim = await client.query<{ id: string }>(
          `select id from media_object_operations
            where id=$1 and claim_token=$2 and status='claimed' and lease_until>now()`,
          [operation.id, operation.claimToken],
        );
        if (!claim.rows[0]) return false;
        await deleteObject(operation.targetKey, { scope: operation.targetScope });
        const settled = await client.query<{ id: string }>(
          `update media_object_operations
              set status='completed', claim_token=null, claim_owner=null, lease_until=null,
                  completed_at=now(), updated_at=now(), last_error=null
            where id=$1 and claim_token=$2 and status='claimed' and lease_until>now()
            returning id`,
          [operation.id, operation.claimToken],
        );
        return settled.rows.length === 1;
      });
      if (completed) result.completed += 1;
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
