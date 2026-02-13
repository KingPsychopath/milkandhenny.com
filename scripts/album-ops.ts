/**
 * Album & photo business logic.
 *
 * All functions return structured data — no console output.
 * Reusable in CLI or future API routes.
 */

import fs from "fs";
import path from "path";
import {
  uploadBuffer,
  deleteObjects,
  listObjects,
} from "./r2-client";
import {
  PROCESSABLE_EXTENSIONS,
  processImageVariants,
  mapConcurrent,
} from "./media-processing";

/* ─── Constants ─── */

const ALBUMS_DIR = path.join(process.cwd(), "content", "albums");
const IMAGE_EXTENSIONS = PROCESSABLE_EXTENSIONS;

/* ─── Types ─── */

type PhotoMeta = {
  id: string;
  width: number;
  height: number;
  takenAt?: string; // ISO date from EXIF DateTimeOriginal
};

type AlbumData = {
  title: string;
  date: string;
  description?: string;
  cover: string;
  photos: PhotoMeta[];
};

type AlbumSummary = {
  slug: string;
  title: string;
  date: string;
  photoCount: number;
  cover: string;
  description?: string;
};

type CreateAlbumOpts = {
  dir: string;
  slug: string;
  title: string;
  date: string;
  description?: string;
};

type UpdateAlbumOpts = {
  title?: string;
  date?: string;
  description?: string;
  cover?: string;
};

type ProcessResult = {
  photo: PhotoMeta;
  thumbSize: number;
  fullSize: number;
  originalSize: number;
};

/* ─── Sort helpers ─── */

/** Sort photos by EXIF date (earliest first), falling back to filename */
function sortByDate(photos: { photo: PhotoMeta; [k: string]: unknown }[]) {
  return photos.sort((a, b) => {
    const dateA = a.photo.takenAt;
    const dateB = b.photo.takenAt;
    // Both have dates → sort chronologically
    if (dateA && dateB) return new Date(dateA).getTime() - new Date(dateB).getTime();
    // Only one has a date → dated photos come first
    if (dateA) return -1;
    if (dateB) return 1;
    // Neither has a date → sort by filename (id)
    return a.photo.id.localeCompare(b.photo.id);
  });
}

/* ─── JSON helpers ─── */

function ensureAlbumsDir() {
  if (!fs.existsSync(ALBUMS_DIR)) {
    fs.mkdirSync(ALBUMS_DIR, { recursive: true });
  }
}

/** Read album JSON from content/albums/ */
function readAlbum(slug: string): AlbumData | null {
  const filePath = path.join(ALBUMS_DIR, `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

/** Write album JSON to content/albums/ */
function writeAlbum(slug: string, data: AlbumData): string {
  ensureAlbumsDir();
  const filePath = path.join(ALBUMS_DIR, `${slug}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  return filePath;
}

/** Delete album JSON file */
function deleteAlbumFile(slug: string): boolean {
  const filePath = path.join(ALBUMS_DIR, `${slug}.json`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

/* ─── Album operations ─── */

/** List all albums from content/albums/ */
function listAlbums(): AlbumSummary[] {
  if (!fs.existsSync(ALBUMS_DIR)) return [];

  return fs
    .readdirSync(ALBUMS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const slug = f.replace(".json", "");
      const data = readAlbum(slug);
      if (!data) return null;
      return {
        slug,
        title: data.title,
        date: data.date,
        photoCount: data.photos.length,
        cover: data.cover,
        description: data.description,
      };
    })
    .filter(Boolean) as AlbumSummary[];
}

/** Get full album details */
function getAlbum(slug: string): (AlbumData & { slug: string }) | null {
  const data = readAlbum(slug);
  if (!data) return null;
  return { ...data, slug };
}

/** Process a single photo: resize, convert, upload all 3 sizes to R2 */
async function processAndUploadPhoto(
  filePath: string,
  albumSlug: string,
  onProgress?: (msg: string) => void
): Promise<ProcessResult> {
  const ext = path.extname(filePath).toLowerCase();
  const id = path.basename(filePath, ext);
  const raw = fs.readFileSync(filePath);

  const processed = await processImageVariants(raw, ext);

  onProgress?.(
    `Processing ${id} (${processed.width}×${processed.height})${
      processed.takenAt
        ? ` taken ${new Date(processed.takenAt).toLocaleDateString()}`
        : ""
    }...`
  );

  /* Upload all 3 versions */
  const prefix = `albums/${albumSlug}`;
  await Promise.all([
    uploadBuffer(`${prefix}/thumb/${id}.webp`, processed.thumb.buffer, processed.thumb.contentType),
    uploadBuffer(`${prefix}/full/${id}.webp`, processed.full.buffer, processed.full.contentType),
    uploadBuffer(`${prefix}/original/${id}.jpg`, processed.original.buffer, processed.original.contentType),
  ]);

  onProgress?.(`Uploaded ${id}`);

  return {
    photo: {
      id,
      width: processed.width,
      height: processed.height,
      ...(processed.takenAt ? { takenAt: processed.takenAt } : {}),
    },
    thumbSize: processed.thumb.buffer.byteLength,
    fullSize: processed.full.buffer.byteLength,
    originalSize: processed.original.buffer.byteLength,
  };
}

/** Create a new album: process all images from dir, upload, write JSON */
async function createAlbum(
  opts: CreateAlbumOpts,
  onProgress?: (msg: string) => void
): Promise<{ album: AlbumData; jsonPath: string; results: ProcessResult[] }> {
  const absDir = path.resolve(opts.dir);
  if (!fs.existsSync(absDir)) {
    throw new Error(`Directory not found: ${absDir}`);
  }

  const files = fs
    .readdirSync(absDir)
    .filter((f) => IMAGE_EXTENSIONS.test(f))
    .sort();

  if (files.length === 0) {
    throw new Error(`No image files found in ${absDir}`);
  }

  onProgress?.(`Found ${files.length} photos. Uploading...`);

  const results = await mapConcurrent(files, 3, (file) =>
    processAndUploadPhoto(path.join(absDir, file), opts.slug, onProgress)
  );

  // Sort by EXIF date (earliest first), falling back to filename
  sortByDate(results);
  const datedCount = results.filter((r) => r.photo.takenAt).length;
  onProgress?.(`Sorted ${results.length} photos (${datedCount} with EXIF dates, ${results.length - datedCount} by filename)`);

  const album: AlbumData = {
    title: opts.title,
    date: opts.date,
    ...(opts.description ? { description: opts.description } : {}),
    cover: results[0].photo.id,
    photos: results.map((r) => r.photo),
  };

  const jsonPath = writeAlbum(opts.slug, album);
  return { album, jsonPath, results };
}

/** Update album metadata (title, date, description, cover) */
function updateAlbumMeta(
  slug: string,
  updates: UpdateAlbumOpts
): AlbumData | null {
  const data = readAlbum(slug);
  if (!data) return null;

  if (updates.title !== undefined) data.title = updates.title;
  if (updates.date !== undefined) data.date = updates.date;
  if (updates.description !== undefined) data.description = updates.description;
  if (updates.cover !== undefined) {
    const exists = data.photos.some((p) => p.id === updates.cover);
    if (!exists) throw new Error(`Photo "${updates.cover}" not found in album`);
    data.cover = updates.cover;
  }

  writeAlbum(slug, data);
  return data;
}

/** Delete an entire album: R2 files + JSON */
async function deleteAlbum(
  slug: string,
  onProgress?: (msg: string) => void
): Promise<{ deletedFiles: number; jsonDeleted: boolean }> {
  /* Delete all R2 objects under this album's prefix */
  const prefix = `albums/${slug}/`;
  onProgress?.(`Listing files under ${prefix}...`);

  const objects = await listObjects(prefix);
  const keys = objects.map((o) => o.key);

  let deletedFiles = 0;
  if (keys.length > 0) {
    onProgress?.(`Deleting ${keys.length} files from R2...`);
    deletedFiles = await deleteObjects(keys);
  }

  /* Delete local JSON */
  const jsonDeleted = deleteAlbumFile(slug);
  onProgress?.(`Done.`);

  return { deletedFiles, jsonDeleted };
}

/* ─── Photo operations ─── */

/** Add photos from a directory to an existing album */
async function addPhotos(
  slug: string,
  dir: string,
  onProgress?: (msg: string) => void
): Promise<{ added: ProcessResult[]; album: AlbumData }> {
  const data = readAlbum(slug);
  if (!data) throw new Error(`Album "${slug}" not found`);

  const absDir = path.resolve(dir);
  if (!fs.existsSync(absDir)) {
    throw new Error(`Directory not found: ${absDir}`);
  }

  const existingIds = new Set(data.photos.map((p) => p.id));
  const files = fs
    .readdirSync(absDir)
    .filter((f) => IMAGE_EXTENSIONS.test(f))
    .sort();

  if (files.length === 0) {
    throw new Error(`No image files found in ${absDir}`);
  }

  // Filter out duplicates before processing
  const newFiles = files.filter((file) => {
    const ext = path.extname(file).toLowerCase();
    const id = path.basename(file, ext);
    if (existingIds.has(id)) {
      onProgress?.(`Skipping ${id} (already in album)`);
      return false;
    }
    return true;
  });

  const added = await mapConcurrent(newFiles, 3, (file) =>
    processAndUploadPhoto(path.join(absDir, file), slug, onProgress)
  );

  for (const result of added) {
    data.photos.push(result.photo);
  }

  // Re-sort the entire album by EXIF date so new photos slot in chronologically
  const allWrapped = data.photos.map((photo) => ({ photo }));
  sortByDate(allWrapped);
  data.photos = allWrapped.map((w) => w.photo);

  const datedCount = data.photos.filter((p) => p.takenAt).length;
  onProgress?.(`Re-sorted album (${datedCount}/${data.photos.length} with EXIF dates)`);

  writeAlbum(slug, data);
  return { added, album: data };
}

/** Delete a single photo from an album (R2 + JSON) */
async function deletePhoto(
  slug: string,
  photoId: string,
  onProgress?: (msg: string) => void
): Promise<{ album: AlbumData; deletedKeys: string[] }> {
  const data = readAlbum(slug);
  if (!data) throw new Error(`Album "${slug}" not found`);

  const photoIdx = data.photos.findIndex((p) => p.id === photoId);
  if (photoIdx === -1) {
    throw new Error(`Photo "${photoId}" not found in album "${slug}"`);
  }

  /* Delete from R2 */
  const prefix = `albums/${slug}`;
  const keys = [
    `${prefix}/thumb/${photoId}.webp`,
    `${prefix}/full/${photoId}.webp`,
    `${prefix}/original/${photoId}.jpg`,
  ];

  onProgress?.(`Deleting ${photoId} from R2...`);
  await deleteObjects(keys);

  /* Remove from JSON */
  data.photos.splice(photoIdx, 1);

  /* Update cover if deleted photo was the cover */
  if (data.cover === photoId && data.photos.length > 0) {
    data.cover = data.photos[0].id;
    onProgress?.(`Cover was deleted. New cover: ${data.cover}`);
  }

  writeAlbum(slug, data);
  return { album: data, deletedKeys: keys };
}

/** Set album cover photo */
function setCover(slug: string, photoId: string): AlbumData {
  const data = readAlbum(slug);
  if (!data) throw new Error(`Album "${slug}" not found`);

  const exists = data.photos.some((p) => p.id === photoId);
  if (!exists) throw new Error(`Photo "${photoId}" not found in album "${slug}"`);

  data.cover = photoId;
  writeAlbum(slug, data);
  return data;
}

/** Get the R2 keys for a photo (for display/debugging) */
function getPhotoKeys(albumSlug: string, photoId: string): string[] {
  const prefix = `albums/${albumSlug}`;
  return [
    `${prefix}/thumb/${photoId}.webp`,
    `${prefix}/full/${photoId}.webp`,
    `${prefix}/original/${photoId}.jpg`,
  ];
}

export {
  listAlbums,
  getAlbum,
  createAlbum,
  updateAlbumMeta,
  deleteAlbum,
  addPhotos,
  deletePhoto,
  setCover,
  getPhotoKeys,
};

export type {
  PhotoMeta,
  AlbumData,
  AlbumSummary,
  CreateAlbumOpts,
  UpdateAlbumOpts,
  ProcessResult,
};
