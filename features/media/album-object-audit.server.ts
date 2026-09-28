import { headObject } from "@/lib/platform/object-storage-provider-context.server";
import { query } from "@/lib/platform/postgres.server";
import { privatePhotoKeys, publicPhotoKeys } from "./album-object-keys";

type PhotoRow = {
  slug: string;
  photo_id: string;
  widths: number[];
  status: "draft" | "published";
  size_bytes: string | null;
};

export type AlbumObjectIssue = {
  slug: string;
  photoId: string;
  scope: "private" | "public";
  key: string;
  kind: "missing" | "size_mismatch" | "size_unverified";
  expectedBytes?: number;
  actualBytes?: number;
};

export type AlbumObjectAudit = {
  photosChecked: number;
  objectsChecked: number;
  complete: boolean;
  issues: AlbumObjectIssue[];
};

/** Read-only, bounded release check for every object referenced by a Postgres album photo. */
export async function auditPostgresAlbumObjects(limit = 250): Promise<AlbumObjectAudit> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000)
    throw new Error("Invalid album object audit limit");
  const rows = await query<PhotoRow>(
    `select a.slug,p.photo_id,p.widths,a.status,p.size_bytes::text
       from gallery_album_photos p join gallery_albums a on a.slug=p.album_slug
      order by a.slug,p.photo_id limit $1`,
    [limit + 1],
  );
  const complete = rows.length <= limit;
  const photos = rows.slice(0, limit);
  const issues: AlbumObjectIssue[] = [];
  let objectsChecked = 0;
  for (const photo of photos) {
    const privateKeys = privatePhotoKeys(photo.slug, { id: photo.photo_id, widths: photo.widths });
    const publicKeys =
      photo.status === "published"
        ? publicPhotoKeys(photo.slug, { id: photo.photo_id, widths: photo.widths })
        : [];
    const targets = [
      ...privateKeys.map((key) => ({ key, scope: "private" as const })),
      ...publicKeys.map((key) => ({ key, scope: "public" as const })),
    ];
    for (let index = 0; index < targets.length; index += 4) {
      const batch = targets.slice(index, index + 4);
      const metadata = await Promise.all(
        batch.map((target) => headObject(target.key, { scope: target.scope })),
      );
      for (let targetIndex = 0; targetIndex < batch.length; targetIndex++) {
        const target = batch[targetIndex];
        const object = metadata[targetIndex];
        objectsChecked += 1;
        if (!object.exists) {
          issues.push({
            slug: photo.slug,
            photoId: photo.photo_id,
            ...target,
            kind: "missing",
          });
          continue;
        }
        if (
          target.scope === "private" &&
          target.key === `albums/${photo.slug}/original/${photo.photo_id}.jpg` &&
          photo.size_bytes !== null
        ) {
          const expectedBytes = Number(photo.size_bytes);
          if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0)
            throw new Error("Invalid stored album original size");
          if (object.size === undefined)
            issues.push({
              slug: photo.slug,
              photoId: photo.photo_id,
              ...target,
              kind: "size_unverified",
              expectedBytes,
            });
          else if (object.size !== expectedBytes)
            issues.push({
              slug: photo.slug,
              photoId: photo.photo_id,
              ...target,
              kind: "size_mismatch",
              expectedBytes,
              actualBytes: object.size,
            });
        }
      }
    }
  }
  return { photosChecked: photos.length, objectsChecked, complete, issues };
}
