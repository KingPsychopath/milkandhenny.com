import fs from "fs";
import path from "path";

import {
  deleteObject,
  downloadBuffer,
  headObject,
  isConfigured,
  listObjects,
  uploadBuffer,
} from "@/lib/platform/r2.server";
import { MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL } from "@/lib/shared/media-cache";
import type { Album, Photo } from "./albums";
import { isValidFocalPreset } from "./focal";

const ALBUM_MANIFEST_PREFIX = "albums/_manifests/";
const LOCAL_ALBUMS_DIR = path.join(process.cwd(), "content/albums");
const SAFE_ALBUM_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_PHOTO_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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
    SAFE_PHOTO_ID.test(photo.id) &&
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
      !/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
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

function readLocalAlbum(slug: string): Album | null {
  if (!isSafeAlbumSlug(slug)) return null;
  const file = path.join(LOCAL_ALBUMS_DIR, `${slug}.json`);
  if (!fs.existsSync(file)) return null;
  return parseAlbumManifest(fs.readFileSync(file, "utf-8"), slug);
}

function listLocalAlbums(): Album[] {
  if (!fs.existsSync(LOCAL_ALBUMS_DIR)) return [];
  return fs
    .readdirSync(LOCAL_ALBUMS_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => readLocalAlbum(file.slice(0, -5)))
    .filter((album): album is Album => album !== null);
}

function allowLocalFallback(): boolean {
  return process.env.NODE_ENV !== "production";
}

async function readAlbumManifest(slug: string): Promise<Album | null> {
  if (!isSafeAlbumSlug(slug)) return null;
  if (!isConfigured()) return allowLocalFallback() ? readLocalAlbum(slug) : null;
  const key = albumManifestKey(slug);
  if (!(await headObject(key)).exists) return allowLocalFallback() ? readLocalAlbum(slug) : null;
  const raw = await downloadBuffer(key);
  return parseAlbumManifest(raw.toString("utf-8"), slug);
}

async function listAlbumManifests(): Promise<Album[]> {
  if (!isConfigured()) return allowLocalFallback() ? listLocalAlbums() : [];

  const objects = await listObjects(ALBUM_MANIFEST_PREFIX);
  if (objects.length === 0 && allowLocalFallback()) return listLocalAlbums();
  const albums = await Promise.all(
    objects
      .filter((object) => object.key.endsWith(".json"))
      .map(async (object) => {
        const slug = path.basename(object.key, ".json");
        const raw = await downloadBuffer(object.key);
        return parseAlbumManifest(raw.toString("utf-8"), slug);
      }),
  );
  return albums.filter((album): album is Album => album !== null);
}

async function writeAlbumManifest(album: Album): Promise<Album> {
  if (!isConfigured()) {
    throw new Error("Public object storage is not configured");
  }
  const updated: Album = { ...album, updatedAt: new Date().toISOString() };
  await uploadBuffer(
    albumManifestKey(album.slug),
    Buffer.from(`${JSON.stringify(updated, null, 2)}\n`, "utf-8"),
    "application/json; charset=utf-8",
    { cacheControl: MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL },
  );
  return updated;
}

async function deleteAlbumManifest(slug: string): Promise<void> {
  await deleteObject(albumManifestKey(slug));
}

async function seedAlbumManifestsFromLocal(): Promise<{ written: number }> {
  if (!isConfigured()) throw new Error("Public object storage is not configured");
  const albums = listLocalAlbums();
  await Promise.all(albums.map((album) => writeAlbumManifest(album)));
  return { written: albums.length };
}

export {
  ALBUM_MANIFEST_PREFIX,
  albumManifestKey,
  deleteAlbumManifest,
  isSafeAlbumSlug,
  listAlbumManifests,
  parseAlbumManifest,
  readAlbumManifest,
  seedAlbumManifestsFromLocal,
  writeAlbumManifest,
};
