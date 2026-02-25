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
  downloadBuffer,
  deleteObjects,
  listObjects,
  headObject,
} from "./r2-client";
import {
  PROCESSABLE_EXTENSIONS,
  processImageVariants,
  processToOg,
  mapConcurrent,
  type OgOverlay,
  type RotationOverride,
} from "../features/media/processing";
import {
  type FocalPreset,
  isValidFocalPreset,
  focalPresetToPercent,
} from "../features/media/focal";
import { detectFocal, type DetectionStrategy } from "./face-detect";

/* ─── Constants ─── */

const ALBUMS_DIR = path.join(process.cwd(), "content", "albums");
const IMAGE_EXTENSIONS = PROCESSABLE_EXTENSIONS;
const ALBUM_UPLOAD_CHECKPOINT_PREFIX = ".mah-album-upload.";
const ALBUM_UPLOAD_CHECKPOINT_SUFFIX = ".checkpoint.json";

/* ─── Types ─── */

type PhotoMeta = {
  id: string;
  width: number;
  height: number;
  /** Tiny base64 data URI for blur-up placeholder */
  blur?: string;
  takenAt?: string; // ISO date from EXIF DateTimeOriginal
  /** Manual crop focal point override (preset name). Takes priority over autoFocal. */
  focalPoint?: FocalPreset;
  /** Auto-detected face center as { x, y } percentages. Used when no manual focalPoint. */
  autoFocal?: { x: number; y: number };
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
  /** Force all photos to portrait or landscape. Leave blank to trust EXIF. */
  rotation?: RotationOverride;
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
  ogSize: number;
};

type AlbumUploadCheckpoint = {
  version: 1;
  dir: string;
  files: string[];
  opts: {
    slug: string;
    title: string;
    date: string;
    description?: string;
    rotation?: RotationOverride;
  };
  completed: Record<string, ProcessResult>;
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

/* ─── Focal resolution ─── */

/**
 * Resolve the effective focal point for a photo.
 * Priority: manual focalPoint preset → auto-detected face → center (50, 50).
 */
function resolveEffectiveFocal(
  photo: PhotoMeta
): { x: number; y: number } {
  if (photo.focalPoint && isValidFocalPreset(photo.focalPoint)) {
    return focalPresetToPercent(photo.focalPoint);
  }
  if (photo.autoFocal) {
    return photo.autoFocal;
  }
  return { x: 50, y: 50 };
}

/* ─── JSON helpers ─── */

function ensureAlbumsDir() {
  if (!fs.existsSync(ALBUMS_DIR)) {
    fs.mkdirSync(ALBUMS_DIR, { recursive: true });
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function getAlbumUploadCheckpointFilename(slug: string): string {
  return `${ALBUM_UPLOAD_CHECKPOINT_PREFIX}${slug}${ALBUM_UPLOAD_CHECKPOINT_SUFFIX}`;
}

function getAlbumUploadCheckpointPath(absDir: string, slug: string): string {
  return path.join(absDir, getAlbumUploadCheckpointFilename(slug));
}

function writeAlbumUploadCheckpoint(absDir: string, slug: string, checkpoint: AlbumUploadCheckpoint): void {
  const file = getAlbumUploadCheckpointPath(absDir, slug);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(checkpoint, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

function deleteAlbumUploadCheckpoint(absDir: string, slug: string): void {
  const file = getAlbumUploadCheckpointPath(absDir, slug);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function readAlbumUploadCheckpoint(absDir: string, slug: string): AlbumUploadCheckpoint | null {
  const file = getAlbumUploadCheckpointPath(absDir, slug);
  if (!fs.existsSync(file)) return null;

  const raw = fs.readFileSync(file, "utf-8");
  const parsed = JSON.parse(raw) as Partial<AlbumUploadCheckpoint>;
  if (
    parsed.version !== 1 ||
    typeof parsed.dir !== "string" ||
    !Array.isArray(parsed.files) ||
    !parsed.opts ||
    typeof parsed.opts !== "object" ||
    typeof parsed.opts.slug !== "string" ||
    typeof parsed.opts.title !== "string" ||
    typeof parsed.opts.date !== "string" ||
    !parsed.completed ||
    typeof parsed.completed !== "object"
  ) {
    throw new Error(
      `Invalid album upload checkpoint file: ${file}. Delete it and retry to start fresh.`
    );
  }

  return {
    version: 1,
    dir: parsed.dir,
    files: parsed.files.filter((v): v is string => typeof v === "string"),
    opts: {
      slug: parsed.opts.slug,
      title: parsed.opts.title,
      date: parsed.opts.date,
      ...(typeof parsed.opts.description === "string" ? { description: parsed.opts.description } : {}),
      ...(parsed.opts.rotation === "portrait" || parsed.opts.rotation === "landscape"
        ? { rotation: parsed.opts.rotation }
        : {}),
    },
    completed: parsed.completed as Record<string, ProcessResult>,
  };
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
  onProgress?: (msg: string) => void,
  ogOverlay?: OgOverlay,
  rotationOverride?: RotationOverride,
): Promise<ProcessResult> {
  const rawExt = path.extname(filePath);           // original case: ".HIF"
  const ext = rawExt.toLowerCase();                  // normalised: ".hif"
  const id = path.basename(filePath, rawExt);        // strip with original case → "DSC08382"
  const raw = fs.readFileSync(filePath);

  // Auto-detect focal point (face or saliency)
  const autoFocal = await detectFocal(raw).catch(() => null);

  const processed = await processImageVariants(raw, ext, autoFocal ?? undefined, ogOverlay, rotationOverride);

  const faceTag = autoFocal ? ` 🎯 face(${autoFocal.x}%,${autoFocal.y}%)` : "";
  onProgress?.(
    `Processing ${id} (${processed.width}×${processed.height})${
      processed.takenAt
        ? ` taken ${new Date(processed.takenAt).toLocaleDateString()}`
        : ""
    }${faceTag}...`
  );

  /* Upload all 4 versions */
  const prefix = `albums/${albumSlug}`;
  await Promise.all([
    uploadBuffer(`${prefix}/thumb/${id}.webp`, processed.thumb.buffer, processed.thumb.contentType),
    uploadBuffer(`${prefix}/full/${id}.webp`, processed.full.buffer, processed.full.contentType),
    uploadBuffer(`${prefix}/original/${id}.jpg`, processed.original.buffer, processed.original.contentType),
    uploadBuffer(`${prefix}/og/${id}.jpg`, processed.og.buffer, processed.og.contentType),
  ]);

  onProgress?.(`Uploaded ${id}`);

  return {
    photo: {
      id,
      width: processed.width,
      height: processed.height,
      blur: processed.blur,
      ...(processed.takenAt ? { takenAt: processed.takenAt } : {}),
      ...(autoFocal ? { autoFocal } : {}),
    },
    thumbSize: processed.thumb.buffer.byteLength,
    fullSize: processed.full.buffer.byteLength,
    originalSize: processed.original.buffer.byteLength,
    ogSize: processed.og.buffer.byteLength,
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

  const checkpoint = readAlbumUploadCheckpoint(absDir, opts.slug);
  if (checkpoint && checkpoint.dir !== absDir) {
    throw new Error(
      `Album upload checkpoint directory mismatch at ${getAlbumUploadCheckpointPath(absDir, opts.slug)}. Delete it and retry.`
    );
  }
  if (checkpoint && !arraysEqual(checkpoint.files, files)) {
    throw new Error(
      `Album source files changed since checkpoint was created (${getAlbumUploadCheckpointPath(absDir, opts.slug)}).\n` +
      "Restore the original files or delete the checkpoint file to start a new album upload."
    );
  }
  if (
    checkpoint &&
    (
      checkpoint.opts.slug !== opts.slug ||
      checkpoint.opts.title !== opts.title ||
      checkpoint.opts.date !== opts.date ||
      checkpoint.opts.description !== opts.description ||
      checkpoint.opts.rotation !== opts.rotation
    )
  ) {
    throw new Error(
      `Album upload options changed since checkpoint was created (${getAlbumUploadCheckpointPath(absDir, opts.slug)}).\n` +
      "Rerun with the same slug/title/date/description/rotation or delete the checkpoint file to start fresh."
    );
  }

  const completed = checkpoint?.completed ?? {};
  if (!checkpoint) {
    writeAlbumUploadCheckpoint(absDir, opts.slug, {
      version: 1,
      dir: absDir,
      files,
      opts: {
        slug: opts.slug,
        title: opts.title,
        date: opts.date,
        ...(opts.description ? { description: opts.description } : {}),
        ...(opts.rotation ? { rotation: opts.rotation } : {}),
      },
      completed,
    });
  }

  const pendingFiles = files.filter((file) => !completed[file]);
  const resumedCount = files.length - pendingFiles.length;
  if (checkpoint) {
    onProgress?.(`Resuming album upload ${opts.slug}: ${resumedCount}/${files.length} photos already complete.`);
  } else {
    onProgress?.(`Found ${files.length} photos. Uploading...`);
  }

  let checkpointWriteQueue = Promise.resolve();
  const queueCheckpointWrite = () => {
    checkpointWriteQueue = checkpointWriteQueue.then(() =>
      Promise.resolve().then(() =>
        writeAlbumUploadCheckpoint(absDir, opts.slug, {
          version: 1,
          dir: absDir,
          files,
          opts: {
            slug: opts.slug,
            title: opts.title,
            date: opts.date,
            ...(opts.description ? { description: opts.description } : {}),
            ...(opts.rotation ? { rotation: opts.rotation } : {}),
          },
          completed,
        })
      )
    );
    return checkpointWriteQueue;
  };

  try {
    await mapConcurrent(pendingFiles, 3, async (file) => {
      const id = path.basename(file, path.extname(file));
      const overlay: OgOverlay = { title: opts.title, photoId: id };
      const result = await processAndUploadPhoto(path.join(absDir, file), opts.slug, onProgress, overlay, opts.rotation);
      completed[file] = result;
      await queueCheckpointWrite();
      return result;
    });
  } finally {
    await checkpointWriteQueue;
  }

  const results = files
    .filter((file): file is string => !!completed[file])
    .map((file) => completed[file]);

  if (results.length !== files.length) {
    throw new Error(
      `Album upload checkpoint incomplete (${results.length}/${files.length}). Rerun the same albums upload command to continue.`
    );
  }

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
  try {
    deleteAlbumUploadCheckpoint(absDir, opts.slug);
  } catch {
    // Non-fatal: album JSON is written and uploads completed.
  }
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
  onProgress?: (msg: string) => void,
  rotation?: RotationOverride,
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
    const id = path.basename(file, path.extname(file));
    if (existingIds.has(id)) {
      onProgress?.(`Skipping ${id} (already in album)`);
      return false;
    }
    return true;
  });

  const added = await mapConcurrent(newFiles, 3, (file) => {
    const id = path.basename(file, path.extname(file));
    const overlay: OgOverlay = { title: data.title, photoId: id };
    return processAndUploadPhoto(path.join(absDir, file), slug, onProgress, overlay, rotation);
  });

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
    `${prefix}/og/${photoId}.jpg`,
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
    `${prefix}/og/${photoId}.jpg`,
  ];
}

/** Backfill OG variants for existing albums. Downloads original from R2, processes to og, uploads. */
async function backfillOgVariants(
  onProgress?: (msg: string) => void,
  options?: { force?: boolean; strategy?: DetectionStrategy }
): Promise<{ processed: number; skipped: number; failed: number }> {
  const albums = listAlbums();
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  const force = options?.force ?? false;

  for (const album of albums) {
    const data = getAlbum(album.slug);
    if (!data) continue;

    onProgress?.(`Album: ${data.title} (${data.photos.length} photos)`);
    let needsJsonWrite = false;

    for (const photo of data.photos) {
      const ogKey = `albums/${data.slug}/og/${photo.id}.jpg`;
      const originalKey = `albums/${data.slug}/original/${photo.id}.jpg`;

      const { exists } = await headObject(ogKey);
      if (exists && !force) {
        skipped++;
        onProgress?.(`  Skip ${photo.id} (og exists)`);
        continue;
      }

      try {
        const raw = await downloadBuffer(originalKey);

        // Re-detect face if no autoFocal yet (or force)
        if (!photo.autoFocal || force) {
          const detected = await detectFocal(raw, options?.strategy).catch(() => null);
          if (detected) {
            photo.autoFocal = detected;
            needsJsonWrite = true;
            onProgress?.(`  🎯 face detected at (${detected.x}%, ${detected.y}%)`);
          }
        }

        const focal = resolveEffectiveFocal(photo);
        const overlay: OgOverlay = { title: data.title, photoId: photo.id };
        const og = await processToOg(raw, focal, overlay);
        await uploadBuffer(ogKey, og.buffer, og.contentType);
        processed++;
        onProgress?.(`  ✓ ${photo.id} (${(og.buffer.byteLength / 1024).toFixed(1)} KB)`);
      } catch (err) {
        failed++;
        onProgress?.(`  ✗ ${photo.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (needsJsonWrite) {
      writeAlbum(data.slug, data);
      onProgress?.(`  📝 saved auto-focal data`);
    }
  }

  return { processed, skipped, failed };
}

/** Set focal point for a photo and regenerate its OG image. */
async function setPhotoFocal(
  slug: string,
  photoId: string,
  preset: FocalPreset,
  onProgress?: (msg: string) => void
): Promise<AlbumData> {
  const data = readAlbum(slug);
  if (!data) throw new Error(`Album "${slug}" not found`);

  const photo = data.photos.find((p) => p.id === photoId);
  if (!photo) throw new Error(`Photo "${photoId}" not found in album "${slug}"`);

  if (!isValidFocalPreset(preset)) {
    throw new Error(
      `Invalid preset. Use: center, top, bottom, top left, top right, bottom left, bottom right`
    );
  }

  photo.focalPoint = preset;
  writeAlbum(slug, data);

  onProgress?.(`Regenerating OG image for ${photoId}...`);
  const originalKey = `albums/${slug}/original/${photoId}.jpg`;
  const ogKey = `albums/${slug}/og/${photoId}.jpg`;

  const raw = await downloadBuffer(originalKey);
  const focal = resolveEffectiveFocal(photo);
  const overlay: OgOverlay = { title: data.title, photoId };
  const og = await processToOg(raw, focal, overlay);
  await uploadBuffer(ogKey, og.buffer, og.contentType);
  onProgress?.(`✓ OG updated (${(og.buffer.byteLength / 1024).toFixed(1)} KB)`);

  return data;
}

/**
 * Reset focal point for a photo (or all photos in an album).
 * Clears manual focalPoint, re-detects faces, regenerates OG images.
 */
async function resetPhotoFocal(
  slug: string,
  photoId?: string,
  onProgress?: (msg: string) => void,
  strategy?: DetectionStrategy
): Promise<AlbumData> {
  const data = readAlbum(slug);
  if (!data) throw new Error(`Album "${slug}" not found`);

  const photos = photoId
    ? data.photos.filter((p) => p.id === photoId)
    : data.photos;

  if (photoId && photos.length === 0) {
    throw new Error(`Photo "${photoId}" not found in album "${slug}"`);
  }

  onProgress?.(`Resetting ${photos.length} photo(s) in ${data.title}...`);

  for (const photo of photos) {
    // Clear manual override
    delete photo.focalPoint;

    const originalKey = `albums/${slug}/original/${photo.id}.jpg`;
    const ogKey = `albums/${slug}/og/${photo.id}.jpg`;

    const raw = await downloadBuffer(originalKey);

    // Re-detect face
    const detected = await detectFocal(raw, strategy).catch(() => null);
    photo.autoFocal = detected ?? undefined;
    onProgress?.(
      detected
        ? `  🎯 ${photo.id}: face at (${detected.x}%, ${detected.y}%)`
        : `  ${photo.id}: no face detected, using center`
    );

    // Regenerate OG
    const focal = resolveEffectiveFocal(photo);
    const overlay: OgOverlay = { title: data.title, photoId: photo.id };
    const og = await processToOg(raw, focal, overlay);
    await uploadBuffer(ogKey, og.buffer, og.contentType);
    onProgress?.(`  ✓ ${photo.id} OG updated (${(og.buffer.byteLength / 1024).toFixed(1)} KB)`);
  }

  writeAlbum(slug, data);
  return data;
}

export {
  listAlbums,
  getAlbum,
  createAlbum,
  getAlbumUploadCheckpointFilename,
  updateAlbumMeta,
  deleteAlbum,
  addPhotos,
  deletePhoto,
  setCover,
  setPhotoFocal,
  resetPhotoFocal,
  getPhotoKeys,
  backfillOgVariants,
};

export type {
  PhotoMeta,
  AlbumData,
  AlbumSummary,
  CreateAlbumOpts,
  UpdateAlbumOpts,
  ProcessResult,
};
