import { createHash } from "node:crypto";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { Client } from "pg";

import { parseAlbumManifest } from "@/features/media/album-repository.server";
import type { Album } from "@/features/media/albums";

const PREFIX = "albums/_manifests/";
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

type SourceAlbum = {
  album: Album;
  key: string;
  sha256: string;
  updatedAt: string;
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const expected = Number(process.argv[2]);
  if (!Number.isInteger(expected) || expected < 0 || expected > 10_000)
    throw new Error("Usage: tsx ops/import-gallery-albums.ts <expected-manifest-count>");
  const endpoint =
    process.env.S3_ENDPOINT ?? `https://${requiredEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
  const bucket = requiredEnv("R2_PRIVATE_BUCKET");
  const storage = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    credentials: {
      accessKeyId: requiredEnv("R2_PRIVATE_ACCESS_KEY"),
      secretAccessKey: requiredEnv("R2_PRIVATE_SECRET_KEY"),
    },
  });
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await storage.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: PREFIX,
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of page.Contents ?? []) {
      if (!object.Key || !/^albums\/_manifests\/[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(object.Key))
        throw new Error("Unexpected album manifest object");
      keys.push(object.Key);
    }
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);
  if (keys.length !== expected || new Set(keys).size !== expected)
    throw new Error("Album manifest count or identity does not match the preflight");
  const sources: SourceAlbum[] = [];
  for (const key of keys.sort()) {
    const source = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!source.Body || !source.LastModified)
      throw new Error("Album manifest body or modification time is missing");
    const bytes = Buffer.from(await source.Body.transformToByteArray());
    if (bytes.length > MAX_MANIFEST_BYTES) throw new Error("Album manifest is too large");
    const slug = key.slice(PREFIX.length, -".json".length);
    const album = parseAlbumManifest(bytes.toString("utf8"), slug);
    if (!album) throw new Error("Album manifest failed validation");
    const updatedAt = album.updatedAt ?? source.LastModified.toISOString();
    if (!Number.isFinite(Date.parse(updatedAt)))
      throw new Error("Album manifest has an invalid update time");
    sources.push({
      album,
      key,
      updatedAt,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  const client = new Client({ connectionString: requiredEnv("DATABASE_URL") });
  await client.connect();
  try {
    await client.query("begin");
    const existing = await client.query<{
      slug: string;
      source_manifest_key: string | null;
      source_manifest_sha256: string | null;
    }>("select slug, source_manifest_key, source_manifest_sha256 from gallery_albums for update");
    if (existing.rows.length > sources.length) throw new Error("Target has extra albums");
    for (const row of existing.rows) {
      const source = sources.find(({ album }) => album.slug === row.slug);
      if (
        !source ||
        row.source_manifest_key !== source.key ||
        row.source_manifest_sha256 !== source.sha256
      )
        throw new Error("Target has runtime or conflicting album data");
    }
    for (const { album, key, sha256, updatedAt } of sources) {
      if (existing.rows.some((row) => row.slug === album.slug)) {
        const photos = await client.query<{ photo_id: string }>(
          "select photo_id from gallery_album_photos where album_slug = $1 order by position",
          [album.slug],
        );
        if (
          photos.rows.map(({ photo_id }) => photo_id).join("\n") !==
          album.photos.map(({ id }) => id).join("\n")
        )
          throw new Error("Imported album photo order differs from source");
        continue;
      }
      await client.query(
        `insert into gallery_albums
           (slug, title, album_date, description, cover_photo_id, status, updated_at,
            revision, source_manifest_key, source_manifest_sha256)
         values ($1,$2,$3,$4,$5,$6,$7,1,$8,$9)`,
        [
          album.slug,
          album.title,
          album.date,
          album.description ?? null,
          album.cover || null,
          album.status ?? "published",
          updatedAt,
          key,
          sha256,
        ],
      );
      for (const [position, photo] of album.photos.entries()) {
        await client.query(
          `insert into gallery_album_photos
             (album_slug, photo_id, position, width, height, version, widths,
              placeholder, title, alt, caption, size_bytes, taken_at, focal_point, auto_focal)
           values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
          [
            album.slug,
            photo.id,
            position,
            photo.width,
            photo.height,
            photo.version,
            photo.widths,
            JSON.stringify(photo.placeholder),
            photo.title ?? null,
            photo.alt ?? null,
            photo.caption ?? null,
            photo.size ?? null,
            photo.takenAt ?? null,
            photo.focalPoint ?? null,
            photo.autoFocal ? JSON.stringify(photo.autoFocal) : null,
          ],
        );
      }
    }
    await client.query("commit");
    console.log(
      `albums=${sources.length} photos=${sources.reduce((sum, source) => sum + source.album.photos.length, 0)}`,
    );
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
    storage.destroy();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
