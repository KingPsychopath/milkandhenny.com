import {
  deleteObject,
  downloadBuffer,
  headObject,
  isConfigured,
  listObjects,
  uploadBuffer,
} from "@/lib/platform/r2.server";
import { PRIVATE_MEDIA_CACHE_CONTROL } from "@/lib/shared/media-cache";
import { isSafeAlbumPhotoId, isValidAlbumDate, type Album, type Photo } from "./albums";
import { isValidFocalPreset } from "./focal";

const ALBUM_MANIFEST_PREFIX = "albums/_manifests/";
const SAFE_ALBUM_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isSafeAlbumSlug(slug: string): boolean {
  return SAFE_ALBUM_SLUG.test(slug);
}

function albumManifestKey(slug: string): string {
  if (!isSafeAlbumSlug(slug)) throw new Error("Invalid album slug");
  return `${ALBUM_MANIFEST_PREFIX}${slug}.json`;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isPhotoManifest(value: unknown): value is Photo {
  if (!value || typeof value !== "object") return false;
  const photo = value as Partial<Photo>;
  return (
    typeof photo.id === "string" &&
    isSafeAlbumPhotoId(photo.id) &&
    typeof photo.width === "number" &&
    Number.isFinite(photo.width) &&
    photo.width > 0 &&
    typeof photo.height === "number" &&
    Number.isFinite(photo.height) &&
    photo.height > 0 &&
    typeof photo.version === "string" &&
    photo.version.length > 0 &&
    Array.isArray(photo.widths) &&
    photo.widths.length > 0 &&
    photo.widths.every(
      (width) => typeof width === "number" && Number.isFinite(width) && width > 0,
    ) &&
    !!photo.placeholder &&
    typeof photo.placeholder.color === "string" &&
    isOptionalString(photo.placeholder.blurDataUrl) &&
    isOptionalString(photo.title) &&
    isOptionalString(photo.alt) &&
    isOptionalString(photo.caption) &&
    (photo.size === undefined ||
      (typeof photo.size === "number" && Number.isFinite(photo.size) && photo.size >= 0)) &&
    isOptionalString(photo.takenAt) &&
    (photo.focalPoint === undefined || isValidFocalPreset(photo.focalPoint)) &&
    (photo.autoFocal === undefined ||
      (typeof photo.autoFocal.x === "number" &&
        photo.autoFocal.x >= 0 &&
        photo.autoFocal.x <= 100 &&
        typeof photo.autoFocal.y === "number" &&
        photo.autoFocal.y >= 0 &&
        photo.autoFocal.y <= 100))
  );
}

function parseAlbumManifest(raw: string, expectedSlug?: string): Album | null {
  try {
    const value = JSON.parse(raw) as Partial<Album>;
    const slug = expectedSlug ?? value.slug;
    if (
      !slug ||
      !isSafeAlbumSlug(slug) ||
      (expectedSlug !== undefined && value.slug !== expectedSlug) ||
      typeof value.title !== "string" ||
      typeof value.date !== "string" ||
      !isValidAlbumDate(value.date) ||
      !isOptionalString(value.description) ||
      typeof value.cover !== "string" ||
      !Array.isArray(value.photos) ||
      !value.photos.every(isPhotoManifest) ||
      new Set(value.photos.map((photo) => photo.id)).size !== value.photos.length ||
      (value.cover !== "" && !value.photos.some((photo) => photo.id === value.cover)) ||
      (value.status !== undefined && value.status !== "draft" && value.status !== "published") ||
      (value.status === "published" && (!value.cover || value.photos.length === 0)) ||
      !isOptionalString(value.updatedAt)
    ) {
      return null;
    }
    return {
      ...value,
      slug,
      title: value.title,
      date: value.date,
      cover: value.cover,
      photos: value.photos,
    };
  } catch {
    return null;
  }
}

async function readAlbumManifest(slug: string): Promise<Album | null> {
  if (!isSafeAlbumSlug(slug)) return null;
  if (!isConfigured()) return null;
  const key = albumManifestKey(slug);
  if (!(await headObject(key, { scope: "private" })).exists) return null;
  const raw = await downloadBuffer(key, { scope: "private" });
  return parseAlbumManifest(raw.toString("utf-8"), slug);
}

async function listAlbumManifests(): Promise<Album[]> {
  if (!isConfigured()) return [];

  const objects = await listObjects(ALBUM_MANIFEST_PREFIX, { scope: "private" });
  const albums = await Promise.all(
    objects
      .filter((object) => object.key.endsWith(".json"))
      .map(async (object) => {
        const slug = object.key.slice(ALBUM_MANIFEST_PREFIX.length, -5);
        const raw = await downloadBuffer(object.key, { scope: "private" });
        return parseAlbumManifest(raw.toString("utf-8"), slug);
      }),
  );
  return albums.filter((album): album is Album => album !== null);
}

async function writeAlbumManifest(album: Album): Promise<Album> {
  if (!isConfigured()) {
    throw new Error("Object storage is not configured");
  }
  const updated: Album = { ...album, updatedAt: new Date().toISOString() };
  await uploadBuffer(
    albumManifestKey(album.slug),
    Buffer.from(`${JSON.stringify(updated, null, 2)}\n`, "utf-8"),
    "application/json; charset=utf-8",
    { cacheControl: PRIVATE_MEDIA_CACHE_CONTROL, scope: "private" },
  );
  return updated;
}

async function deleteAlbumManifest(slug: string): Promise<void> {
  await deleteObject(albumManifestKey(slug), { scope: "private" });
}

export {
  ALBUM_MANIFEST_PREFIX,
  albumManifestKey,
  deleteAlbumManifest,
  isSafeAlbumSlug,
  listAlbumManifests,
  parseAlbumManifest,
  readAlbumManifest,
  writeAlbumManifest,
};
