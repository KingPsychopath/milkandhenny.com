import { query, transaction } from "@/lib/platform/postgres.server";
import { enqueueMediaObjectOperation } from "./object-operations.server";
import type { Album, Photo } from "./albums";

type AlbumRow = {
  slug: string;
  title: string;
  album_date: string;
  description: string | null;
  cover_photo_id: string | null;
  status: "draft" | "published";
  updated_at: Date;
  revision: number;
  photo_id: string | null;
  position: number | null;
  width: number | null;
  height: number | null;
  version: string | null;
  widths: number[] | null;
  placeholder: Photo["placeholder"] | null;
  photo_title: string | null;
  alt: string | null;
  caption: string | null;
  size_bytes: string | null;
  taken_at: string | null;
  focal_point: Photo["focalPoint"] | null;
  auto_focal: Photo["autoFocal"] | null;
};

const SELECT_ALBUMS = `
  select a.slug, a.title, a.album_date::text, a.description, a.cover_photo_id,
         a.status, a.updated_at, a.revision,
         p.photo_id, p.position, p.width, p.height, p.version, p.widths,
         p.placeholder, p.title as photo_title, p.alt, p.caption, p.size_bytes,
         p.taken_at, p.focal_point, p.auto_focal
    from gallery_albums a
    left join gallery_album_photos p on p.album_slug = a.slug
`;

function albumsFromRows(rows: AlbumRow[]): Album[] {
  const albums = new Map<string, Album>();
  for (const row of rows) {
    let album = albums.get(row.slug);
    if (!album) {
      album = {
        slug: row.slug,
        title: row.title,
        date: row.album_date,
        ...(row.description !== null ? { description: row.description } : {}),
        cover: row.cover_photo_id ?? "",
        status: row.status,
        updatedAt: row.updated_at.toISOString(),
        revision: row.revision,
        photos: [],
      };
      albums.set(row.slug, album);
    }
    if (row.photo_id !== null) {
      if (
        row.width === null ||
        row.height === null ||
        row.version === null ||
        row.widths === null ||
        row.placeholder === null
      )
        throw new Error("Incomplete stored album photo");
      album.photos.push({
        id: row.photo_id,
        width: row.width,
        height: row.height,
        version: row.version,
        widths: row.widths,
        placeholder: row.placeholder,
        ...(row.photo_title !== null ? { title: row.photo_title } : {}),
        ...(row.alt !== null ? { alt: row.alt } : {}),
        ...(row.caption !== null ? { caption: row.caption } : {}),
        ...(row.size_bytes !== null ? { size: Number(row.size_bytes) } : {}),
        ...(row.taken_at !== null ? { takenAt: row.taken_at } : {}),
        ...(row.focal_point ? { focalPoint: row.focal_point } : {}),
        ...(row.auto_focal ? { autoFocal: row.auto_focal } : {}),
      });
    }
  }
  return [...albums.values()];
}

export class AlbumWriteConflictError extends Error {
  constructor() {
    super("This album changed while you were editing it. Reload and try again.");
    this.name = "AlbumWriteConflictError";
  }
}

export async function hasPendingPostgresAlbumPublicDeletes(slug: string): Promise<boolean> {
  const rows = await query(
    `select 1 from media_object_operations
      where owner_kind='album' and owner_id=$1 and operation='delete'
        and status <> 'completed' limit 1`,
    [slug],
  );
  return rows.length > 0;
}

export async function readPostgresAlbum(slug: string): Promise<Album | null> {
  const rows = await query<AlbumRow>(`${SELECT_ALBUMS} where a.slug = $1 order by p.position`, [
    slug,
  ]);
  return albumsFromRows(rows)[0] ?? null;
}

export async function listPostgresAlbums(): Promise<Album[]> {
  const rows = await query<AlbumRow>(`${SELECT_ALBUMS} order by a.slug, p.position`);
  return albumsFromRows(rows);
}

export async function writePostgresAlbum(
  album: Album,
  options: { publicDeleteKeys?: readonly string[] } = {},
): Promise<Album> {
  const publicDeleteKeys = options.publicDeleteKeys ?? [];
  if (
    (publicDeleteKeys.length > 0 && album.status !== "draft") ||
    publicDeleteKeys.some((key) => !key.startsWith(`albums/${album.slug}/`))
  )
    throw new Error("Invalid album public deletion intent");
  const updatedAt = new Date().toISOString();
  const nextRevision = await transaction(async (client) => {
    const current = await client.query<{ revision: number }>(
      "select revision from gallery_albums where slug = $1 for update",
      [album.slug],
    );
    const existing = current.rows[0];
    if (existing && album.revision !== existing.revision) throw new AlbumWriteConflictError();
    if (!existing && album.revision !== undefined) throw new AlbumWriteConflictError();
    if (album.status === "published" || !existing) {
      const pending = await client.query(
        `select 1 from media_object_operations
          where owner_kind='album' and owner_id=$1 and operation='delete'
            and status <> 'completed' limit 1`,
        [album.slug],
      );
      if (pending.rows[0]) throw new AlbumWriteConflictError();
    }
    const revision = existing ? existing.revision + 1 : 1;
    const values = [
      album.slug,
      album.title,
      album.date,
      album.description ?? null,
      album.cover || null,
      album.status ?? "published",
      updatedAt,
    ];
    const written = existing
      ? await client.query(
          `update gallery_albums
             set title = $2, album_date = $3, description = $4,
                 cover_photo_id = $5, status = $6, updated_at = $7,
                 revision = revision + 1,
                 source_manifest_key = null, source_manifest_sha256 = null
           where slug = $1 and revision = $8`,
          [...values, existing.revision],
        )
      : await client.query(
          `insert into gallery_albums
             (slug, title, album_date, description, cover_photo_id, status, updated_at, revision)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (slug) do nothing`,
          [...values, revision],
        );
    if (written.rowCount !== 1) throw new AlbumWriteConflictError();
    await client.query("delete from gallery_album_photos where album_slug = $1", [album.slug]);
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
    for (const key of new Set(publicDeleteKeys))
      await enqueueMediaObjectOperation(client, {
        ownerKind: "album",
        ownerId: album.slug,
        ownerRevision: revision,
        operation: "delete",
        targetScope: "public",
        targetKey: key,
      });
    return revision;
  });
  return { ...album, updatedAt, revision: nextRevision };
}

export async function deletePostgresAlbum(slug: string): Promise<void> {
  await query("delete from gallery_albums where slug = $1", [slug]);
}
