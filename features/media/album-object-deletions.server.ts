import { claimMediaObjectOperations, failMediaObjectOperation } from "./object-operations.server";
import { copyObject, deleteObject } from "@/lib/platform/object-storage-provider-context.server";
import { transaction } from "@/lib/platform/postgres.server";
import { privatePhotoKeys, publicPhotoKeys } from "./album-object-keys";

export type AlbumObjectOperationBatch = {
  claimed: number;
  completed: number;
  retried: number;
  lostClaim: number;
};

/** Album revisions and R2 mutations serialize so old work cannot overwrite new visibility. */
export async function runAlbumObjectOperationBatch(
  owner: string,
  limit = 10,
  albumId?: string,
): Promise<AlbumObjectOperationBatch> {
  const claimed = await claimMediaObjectOperations(owner, limit, 5 * 60_000, "album", albumId);
  const result: AlbumObjectOperationBatch = {
    claimed: claimed.length,
    completed: 0,
    retried: 0,
    lostClaim: 0,
  };
  for (const operation of claimed) {
    try {
      const completed = await transaction(async (client) => {
        // Hold the same lock as album writes across the external deletion. A worker that
        // resumes after its lease expires cannot erase a key republished by a newer revision.
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `album:${operation.ownerId}`,
        ]);
        const current = await client.query<{
          status: "draft" | "publishing" | "published";
          revision: number;
        }>("select status,revision from gallery_albums where slug=$1", [operation.ownerId]);
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
        const claim = await client.query<{ id: string }>(
          `select id from media_object_operations
            where id=$1 and claim_token=$2 and status='claimed' and lease_until>now()`,
          [operation.id, operation.claimToken],
        );
        if (!claim.rows[0]) return false;
        if (operation.operation === "delete") {
          if (
            referenced.has(operation.targetKey) &&
            (operation.targetScope === "private" || current.rows[0]?.status !== "draft")
          )
            throw new Error("Album object is referenced");
          await deleteObject(operation.targetKey, { scope: operation.targetScope });
        } else if (operation.operation === "copy") {
          if (
            current.rows[0]?.status === "publishing" &&
            current.rows[0].revision === operation.ownerRevision
          ) {
            if (
              operation.sourceScope !== "private" ||
              operation.targetScope !== "public" ||
              !operation.sourceKey ||
              !referenced.has(operation.targetKey)
            )
              throw new Error("Invalid album publication object");
            await copyObject(operation.sourceKey, operation.targetKey, {
              sourceScope: "private",
              destinationScope: "public",
              contentType: operation.contentType ?? undefined,
              cacheControl: operation.cacheControl ?? undefined,
            });
          }
          // A newer revision cancels this copy; its draft transition owns cleanup of any
          // public object copied by an earlier attempt.
        }
        const settled = await client.query<{ id: string }>(
          `update media_object_operations
              set status='completed', claim_token=null, claim_owner=null, lease_until=null,
                  completed_at=now(), updated_at=now(), last_error=null
            where id=$1 and claim_token=$2 and status='claimed' and lease_until>now()
            returning id`,
          [operation.id, operation.claimToken],
        );
        if (settled.rows.length !== 1) return false;
        if (
          operation.operation === "copy" &&
          current.rows[0]?.status === "publishing" &&
          current.rows[0].revision === operation.ownerRevision
        ) {
          const remaining = await client.query(
            `select 1 from media_object_operations
              where owner_kind='album' and owner_id=$1 and owner_revision=$2
                and operation='copy' and status <> 'completed' limit 1`,
            [operation.ownerId, operation.ownerRevision],
          );
          if (!remaining.rows[0])
            await client.query(
              `update gallery_albums set status='published'
                where slug=$1 and revision=$2 and status='publishing'`,
              [operation.ownerId, operation.ownerRevision],
            );
        }
        return true;
      });
      if (completed) result.completed += 1;
      else result.lostClaim += 1;
    } catch {
      const delayMs = Math.min(60_000, 1_000 * 2 ** Math.min(operation.attempt - 1, 6));
      if (
        await failMediaObjectOperation(
          operation.id,
          operation.claimToken,
          "album_object_operation_failed",
          delayMs,
        )
      )
        result.retried += 1;
      else result.lostClaim += 1;
    }
  }
  return result;
}

export const runAlbumObjectDeletionBatch = runAlbumObjectOperationBatch;
