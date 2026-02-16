import fs from "fs";
import path from "path";
import { deleteObjects, listObjects } from "@/lib/platform/r2";

const ALBUMS_DIR = path.join(process.cwd(), "content/albums");
const SAFE_ALBUM_SLUG = /^[a-z0-9-]+$/;
const SAFE_PHOTO_ID = /^[A-Za-z0-9._-]+$/;

type AlbumPhoto = { id: string; [key: string]: unknown };
type AlbumJson = {
  title: string;
  date: string;
  description?: string;
  cover: string;
  photos: AlbumPhoto[];
};

type AdminAlbum = {
  slug: string;
  title: string;
  date: string;
  description?: string;
  cover: string;
  photoCount: number;
  photos: string[];
};

function isSafeAlbumSlug(slug: string): boolean {
  return SAFE_ALBUM_SLUG.test(slug);
}

function isSafePhotoId(photoId: string): boolean {
  return SAFE_PHOTO_ID.test(photoId);
}

function parseAlbum(raw: string): AlbumJson | null {
  try {
    const data = JSON.parse(raw) as Partial<AlbumJson>;
    if (
      !data ||
      typeof data.title !== "string" ||
      typeof data.date !== "string" ||
      typeof data.cover !== "string" ||
      !Array.isArray(data.photos)
    ) {
      return null;
    }
    // Preserve full photo metadata (width/height/blur/etc.) so admin edits
    // do not accidentally strip required fields from album manifests.
    const photos = data.photos
      .filter(
        (p): p is AlbumPhoto =>
          !!p && typeof p === "object" && typeof (p as { id?: unknown }).id === "string"
      )
      .map((p) => ({ ...p, id: p.id }));
    return {
      title: data.title,
      date: data.date,
      description: typeof data.description === "string" ? data.description : undefined,
      cover: data.cover,
      photos,
    };
  } catch {
    return null;
  }
}

function getAlbumFilePath(slug: string): string {
  return path.join(ALBUMS_DIR, `${slug}.json`);
}

function assertAlbumManifestWritable(): void {
  try {
    fs.accessSync(ALBUMS_DIR, fs.constants.W_OK);
  } catch {
    throw new Error(
      "Album manifests are read-only in this runtime. Use the CLI and commit changes to git."
    );
  }
}

function readAlbum(slug: string): AlbumJson | null {
  if (!isSafeAlbumSlug(slug)) return null;
  const filePath = getAlbumFilePath(slug);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  return parseAlbum(raw);
}

function writeAlbum(slug: string, album: AlbumJson): void {
  assertAlbumManifestWritable();
  const filePath = getAlbumFilePath(slug);
  fs.writeFileSync(filePath, `${JSON.stringify(album, null, 2)}\n`);
}

function toAdminAlbum(slug: string, album: AlbumJson): AdminAlbum {
  return {
    slug,
    title: album.title,
    date: album.date,
    description: album.description,
    cover: album.cover,
    photoCount: album.photos.length,
    photos: album.photos.map((p) => p.id),
  };
}

function listAdminAlbums(): AdminAlbum[] {
  if (!fs.existsSync(ALBUMS_DIR)) return [];

  const albums = fs
    .readdirSync(ALBUMS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .map((slug) => {
      const album = readAlbum(slug);
      if (!album) return null;
      return toAdminAlbum(slug, album);
    })
    .filter((a): a is AdminAlbum => a !== null);

  return albums.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

async function deleteAlbum(slug: string): Promise<{ deletedFiles: number; deletedJson: boolean }> {
  if (!isSafeAlbumSlug(slug)) {
    throw new Error("Invalid album slug");
  }

  assertAlbumManifestWritable();
  const prefix = `albums/${slug}/`;
  const objects = await listObjects(prefix);
  const keys = objects.map((o) => o.key);
  const deletedFiles = keys.length > 0 ? await deleteObjects(keys) : 0;

  const filePath = getAlbumFilePath(slug);
  const deletedJson = fs.existsSync(filePath);
  if (deletedJson) {
    fs.unlinkSync(filePath);
  }

  return { deletedFiles, deletedJson };
}

async function deleteAlbumPhoto(
  slug: string,
  photoId: string
): Promise<{ album: AdminAlbum; deletedKeys: string[] }> {
  if (!isSafeAlbumSlug(slug)) throw new Error("Invalid album slug");
  if (!isSafePhotoId(photoId)) throw new Error("Invalid photo id");

  assertAlbumManifestWritable();
  const album = readAlbum(slug);
  if (!album) throw new Error("Album not found");

  const photoIndex = album.photos.findIndex((p) => p.id === photoId);
  if (photoIndex === -1) {
    throw new Error("Photo not found in album");
  }
  if (album.photos.length <= 1) {
    throw new Error("Cannot delete the last photo. Delete the album instead.");
  }

  const prefix = `albums/${slug}`;
  const keys = [
    `${prefix}/thumb/${photoId}.webp`,
    `${prefix}/full/${photoId}.webp`,
    `${prefix}/original/${photoId}.jpg`,
    `${prefix}/og/${photoId}.jpg`,
  ];
  await deleteObjects(keys);

  album.photos.splice(photoIndex, 1);
  if (album.cover === photoId) {
    album.cover = album.photos[0].id;
  }
  writeAlbum(slug, album);

  return { album: toAdminAlbum(slug, album), deletedKeys: keys };
}

function setAlbumCover(slug: string, photoId: string): AdminAlbum {
  if (!isSafeAlbumSlug(slug)) throw new Error("Invalid album slug");
  if (!isSafePhotoId(photoId)) throw new Error("Invalid photo id");
  assertAlbumManifestWritable();

  const album = readAlbum(slug);
  if (!album) throw new Error("Album not found");
  if (!album.photos.some((p) => p.id === photoId)) {
    throw new Error("Photo not found in album");
  }

  album.cover = photoId;
  writeAlbum(slug, album);
  return toAdminAlbum(slug, album);
}

export { isSafeAlbumSlug, listAdminAlbums, deleteAlbum, deleteAlbumPhoto, setAlbumCover };
export type { AdminAlbum };
