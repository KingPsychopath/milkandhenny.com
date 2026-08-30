import path from "path";
import { randomUUID } from "crypto";

import {
  deleteObjects,
  downloadBuffer,
  headObject,
  listObjects,
  presignPutUrl,
  uploadBuffer,
} from "@/lib/platform/r2.server";
import {
  MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL,
  PRIVATE_MEDIA_CACHE_CONTROL,
  VERSIONED_PUBLIC_MEDIA_CACHE_CONTROL,
} from "@/lib/shared/media-cache";
import {
  albumManifestKey,
  deleteAlbumManifest,
  isSafeAlbumSlug,
  listAlbumManifests,
  readAlbumManifest,
  writeAlbumManifest,
} from "./album-repository.server";
import { isSafeAlbumPhotoId, isValidAlbumDate, type Album, type Photo } from "./albums";
import { focalPresetToPercent, isValidFocalPreset } from "./focal";
import {
  isProcessableImage,
  mapConcurrent,
  processAlbumSource,
  processResponsiveImage,
  processToOg,
  type OgOverlay,
} from "./processing.server";

const MAX_ALBUM_FILES = 200;
const MAX_ALBUM_FILE_BYTES = 100 * 1024 * 1024;

interface AdminAlbum extends Album {
  photoCount: number;
}

interface AlbumUploadInput {
  name: string;
  size: number;
  type: string;
}

interface PreparedAlbumUpload {
  original: string;
  photoId: string;
  uploadKey: string;
  url: string;
  contentType: string;
}

interface AlbumMetadataInput {
  title?: unknown;
  date?: unknown;
  description?: unknown;
  status?: unknown;
}

interface PhotoMetadataInput {
  title?: unknown;
  alt?: unknown;
  caption?: unknown;
  focalPoint?: unknown;
}

function isSafePhotoId(photoId: string): boolean {
  return isSafeAlbumPhotoId(photoId);
}

function cleanAlbumDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  return isValidAlbumDate(clean) ? clean : undefined;
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : undefined;
}

function normaliseSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalisePhotoId(filename: string): string {
  const extension = path.extname(filename);
  const stem = path.basename(filename, extension);
  const clean = stem
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 100);
  return clean || `photo-${randomUUID().slice(0, 8)}`;
}

function toAdminAlbum(album: Album): AdminAlbum {
  return { ...album, photoCount: album.photos.length };
}

function privatePhotoKeys(slug: string, photo: Photo): string[] {
  return [...publicPhotoKeys(slug, photo), `albums/${slug}/original/${photo.id}.jpg`];
}

function publicPhotoKeys(slug: string, photo: Photo): string[] {
  return [
    ...photo.widths.flatMap((width) =>
      (["avif", "webp"] as const).map(
        (format) => `albums/${slug}/images/${photo.id}/${width}.${format}`,
      ),
    ),
    `albums/${slug}/og/${photo.id}.jpg`,
  ];
}

function publicObjectMetadata(key: string): { contentType: string; cacheControl: string } {
  if (key.endsWith(".avif")) {
    return { contentType: "image/avif", cacheControl: VERSIONED_PUBLIC_MEDIA_CACHE_CONTROL };
  }
  if (key.endsWith(".webp")) {
    return { contentType: "image/webp", cacheControl: VERSIONED_PUBLIC_MEDIA_CACHE_CONTROL };
  }
  return { contentType: "image/jpeg", cacheControl: MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL };
}

async function publishAlbumAssets(album: Album): Promise<void> {
  const keys = album.photos.flatMap((photo) => publicPhotoKeys(album.slug, photo));
  await mapConcurrent(keys, 4, async (key) => {
    const body = await downloadBuffer(key, { scope: "private" });
    const metadata = publicObjectMetadata(key);
    await uploadBuffer(key, body, metadata.contentType, {
      scope: "public",
      cacheControl: metadata.cacheControl,
    });
  });
}

async function unpublishAlbumAssets(album: Album): Promise<void> {
  await deleteObjects(
    album.photos.flatMap((photo) => publicPhotoKeys(album.slug, photo)),
    {
      scope: "public",
    },
  );
}

async function regenerateAlbumOg(album: Album): Promise<void> {
  await mapConcurrent(album.photos, 2, async (photo) => {
    const raw = await downloadBuffer(`albums/${album.slug}/original/${photo.id}.jpg`, {
      scope: "private",
    });
    const focal = photo.focalPoint
      ? focalPresetToPercent(photo.focalPoint)
      : (photo.autoFocal ?? { x: 50, y: 50 });
    const key = `albums/${album.slug}/og/${photo.id}.jpg`;
    const og = await processToOg(raw, focal, { title: album.title, photoId: photo.id });
    await uploadBuffer(key, og.buffer, og.contentType, {
      scope: "private",
      cacheControl: PRIVATE_MEDIA_CACHE_CONTROL,
    });
  });
}

async function listAdminAlbums(): Promise<AdminAlbum[]> {
  const albums = await listAlbumManifests();
  return albums
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .map(toAdminAlbum);
}

async function createAdminAlbum(
  input: AlbumMetadataInput & { slug?: unknown },
): Promise<AdminAlbum> {
  const slug = typeof input.slug === "string" ? normaliseSlug(input.slug) : "";
  const title = cleanText(input.title, 160);
  const date = cleanAlbumDate(input.date);
  if (!slug || !isSafeAlbumSlug(slug)) throw new Error("Enter a valid album slug");
  if (!title) throw new Error("Album title is required");
  if (!date) throw new Error("Album date is required");
  if (await readAlbumManifest(slug)) throw new Error("An album with this slug already exists");

  const album = await writeAlbumManifest({
    slug,
    title,
    date,
    description: cleanText(input.description, 1000),
    cover: "",
    photos: [],
    status: "draft",
  });
  return toAdminAlbum(album);
}

async function updateAlbumMetadata(slug: string, input: AlbumMetadataInput): Promise<AdminAlbum> {
  const album = await readAlbumManifest(slug);
  if (!album) throw new Error("Album not found");
  const title = input.title === undefined ? album.title : cleanText(input.title, 160);
  const date = input.date === undefined ? album.date : cleanAlbumDate(input.date);
  if (!title) throw new Error("Album title is required");
  if (!date) throw new Error("Enter a valid album date");
  const status = input.status === undefined ? album.status : input.status;
  if (status !== undefined && status !== "draft" && status !== "published") {
    throw new Error("Invalid album status");
  }
  if (status === "published" && (!album.photos.length || !album.cover)) {
    throw new Error("Add a photo and choose a cover before publishing");
  }

  const next: Album = {
    ...album,
    title,
    date,
    description:
      input.description === undefined ? album.description : cleanText(input.description, 1000),
    status,
  };
  const wasPublished = album.status !== "draft";
  const willPublish = status !== "draft";
  const titleChanged = title !== album.title;

  if (titleChanged) await regenerateAlbumOg(next);
  if (wasPublished && !willPublish) {
    await unpublishAlbumAssets(album);
    try {
      return toAdminAlbum(await writeAlbumManifest(next));
    } catch (error) {
      await publishAlbumAssets(album).catch(() => undefined);
      throw error;
    }
  }

  if (willPublish && (titleChanged || !wasPublished)) await publishAlbumAssets(next);
  try {
    return toAdminAlbum(await writeAlbumManifest(next));
  } catch (error) {
    if (!wasPublished && willPublish) {
      await unpublishAlbumAssets(next).catch(() => undefined);
    }
    throw error;
  }
}

async function reorderAlbumPhotos(slug: string, photoIds: string[]): Promise<AdminAlbum> {
  const album = await readAlbumManifest(slug);
  if (!album) throw new Error("Album not found");
  const current = new Set(album.photos.map((photo) => photo.id));
  if (photoIds.length !== current.size || new Set(photoIds).size !== current.size) {
    throw new Error("Photo order must contain every photo exactly once");
  }
  if (photoIds.some((id) => !current.has(id)))
    throw new Error("Photo order contains an unknown photo");
  const byId = new Map(album.photos.map((photo) => [photo.id, photo]));
  album.photos = photoIds.map((id) => byId.get(id)).filter((photo): photo is Photo => !!photo);
  return toAdminAlbum(await writeAlbumManifest(album));
}

async function setAlbumCover(slug: string, photoId: string): Promise<AdminAlbum> {
  const album = await readAlbumManifest(slug);
  if (!album) throw new Error("Album not found");
  if (!album.photos.some((photo) => photo.id === photoId))
    throw new Error("Photo not found in album");
  album.cover = photoId;
  return toAdminAlbum(await writeAlbumManifest(album));
}

async function updateAlbumPhoto(
  slug: string,
  photoId: string,
  input: PhotoMetadataInput,
): Promise<AdminAlbum> {
  const album = await readAlbumManifest(slug);
  if (!album) throw new Error("Album not found");
  const photo = album.photos.find((item) => item.id === photoId);
  if (!photo) throw new Error("Photo not found in album");

  if (input.title !== undefined) photo.title = cleanText(input.title, 160);
  if (input.alt !== undefined) photo.alt = cleanText(input.alt, 300);
  if (input.caption !== undefined) photo.caption = cleanText(input.caption, 1000);
  if (input.focalPoint !== undefined) {
    if (input.focalPoint === "") delete photo.focalPoint;
    else if (typeof input.focalPoint === "string" && isValidFocalPreset(input.focalPoint)) {
      photo.focalPoint = input.focalPoint;
    } else throw new Error("Invalid focal point");

    const raw = await downloadBuffer(`albums/${slug}/original/${photo.id}.jpg`, {
      scope: "private",
    });
    const focal = photo.focalPoint
      ? focalPresetToPercent(photo.focalPoint)
      : (photo.autoFocal ?? { x: 50, y: 50 });
    const og = await processToOg(raw, focal, { title: album.title, photoId: photo.id });
    await uploadBuffer(`albums/${slug}/og/${photo.id}.jpg`, og.buffer, og.contentType, {
      scope: "private",
      cacheControl: PRIVATE_MEDIA_CACHE_CONTROL,
    });
    if (album.status !== "draft") {
      await uploadBuffer(`albums/${slug}/og/${photo.id}.jpg`, og.buffer, og.contentType, {
        scope: "public",
        cacheControl: MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL,
      });
    }
  }

  return toAdminAlbum(await writeAlbumManifest(album));
}

async function deleteAlbumPhotos(
  slug: string,
  photoIds: string[],
): Promise<{ album: AdminAlbum; deletedKeys: number }> {
  const album = await readAlbumManifest(slug);
  if (!album) throw new Error("Album not found");
  const publishedSnapshot =
    album.status !== "draft" ? { ...album, photos: [...album.photos] } : null;
  const ids = new Set(photoIds);
  const deleting = album.photos.filter((photo) => ids.has(photo.id));
  if (!deleting.length) throw new Error("No matching photos found");
  const privateKeys = deleting.flatMap((photo) => privatePhotoKeys(slug, photo));
  const publicKeys = deleting.flatMap((photo) => publicPhotoKeys(slug, photo));
  album.photos = album.photos.filter((photo) => !ids.has(photo.id));
  if (ids.has(album.cover)) album.cover = album.photos[0]?.id ?? "";
  if (!album.photos.length) album.status = "draft";
  const deletedPublic = await deleteObjects(publicKeys, { scope: "public" });
  let updated: Album;
  try {
    updated = await writeAlbumManifest(album);
  } catch (error) {
    if (publishedSnapshot) await publishAlbumAssets(publishedSnapshot).catch(() => undefined);
    throw error;
  }
  const deletedPrivate = await deleteObjects(privateKeys, { scope: "private" });
  const deletedKeys = deletedPrivate + deletedPublic;
  return { album: toAdminAlbum(updated), deletedKeys };
}

async function deleteAlbumPhoto(
  slug: string,
  photoId: string,
): Promise<{ album: AdminAlbum; deletedKeys: string[] }> {
  const album = await readAlbumManifest(slug);
  if (!album) throw new Error("Album not found");
  const photo = album.photos.find((item) => item.id === photoId);
  if (!photo) throw new Error("Photo not found in album");
  const keys = [...privatePhotoKeys(slug, photo), ...publicPhotoKeys(slug, photo)];
  const result = await deleteAlbumPhotos(slug, [photoId]);
  return { album: result.album, deletedKeys: keys };
}

async function deleteAlbum(
  slug: string,
): Promise<{ deletedFiles: number; deletedManifest: boolean }> {
  if (!isSafeAlbumSlug(slug)) throw new Error("Invalid album slug");
  const album = await readAlbumManifest(slug);
  const [privateObjects, publicObjects] = await Promise.all([
    listObjects(`albums/${slug}/`, { scope: "private" }),
    listObjects(`albums/${slug}/`, { scope: "public" }),
  ]);
  const manifestKey = albumManifestKey(slug);
  const deletedPublic = await deleteObjects(
    publicObjects.map((object) => object.key),
    { scope: "public" },
  );
  if (album) await deleteAlbumManifest(slug);
  const deletedPrivate = await deleteObjects(
    privateObjects.map((object) => object.key).filter((key) => key !== manifestKey),
    { scope: "private" },
  );
  const deletedFiles = deletedPrivate + deletedPublic;
  return { deletedFiles, deletedManifest: album !== null };
}

async function prepareAlbumUploads(
  slug: string,
  files: AlbumUploadInput[],
): Promise<PreparedAlbumUpload[]> {
  const album = await readAlbumManifest(slug);
  if (!album) throw new Error("Album not found");
  if (!files.length || files.length > MAX_ALBUM_FILES) {
    throw new Error(`Choose between 1 and ${MAX_ALBUM_FILES} images`);
  }
  if (album.photos.length + files.length > MAX_ALBUM_FILES) {
    throw new Error(`An album can contain at most ${MAX_ALBUM_FILES} images`);
  }
  if (
    files.some(
      (file) =>
        !file ||
        typeof file.name !== "string" ||
        typeof file.size !== "number" ||
        (file.type !== undefined && typeof file.type !== "string"),
    )
  ) {
    throw new Error("Each upload needs a file name and size");
  }
  const reserved = new Set(album.photos.map((photo) => photo.id));

  return Promise.all(
    files.map(async (file) => {
      if (!file.name || !Number.isFinite(file.size) || file.size <= 0) {
        throw new Error("Each upload needs a file name and size");
      }
      if (file.size > MAX_ALBUM_FILE_BYTES) throw new Error(`${file.name} is larger than 100 MB`);
      if (!isProcessableImage(file.name)) throw new Error(`${file.name} is not a supported image`);
      const baseId = normalisePhotoId(file.name);
      let photoId = baseId;
      let suffix = 2;
      while (reserved.has(photoId)) photoId = `${baseId}-${suffix++}`;
      reserved.add(photoId);
      const extension =
        path
          .extname(file.name)
          .toLowerCase()
          .replace(/[^.a-z0-9]/g, "") || ".jpg";
      const uploadKey = `incoming/albums/${slug}/${randomUUID()}${extension}`;
      const contentType = file.type?.startsWith("image/") ? file.type : "application/octet-stream";
      return {
        original: file.name,
        photoId,
        uploadKey,
        contentType,
        url: await presignPutUrl(uploadKey, contentType, 15 * 60, {
          scope: "private",
        }),
      };
    }),
  );
}

async function processAlbumUpload(
  album: Album,
  file: Pick<PreparedAlbumUpload, "original" | "photoId" | "uploadKey">,
): Promise<Photo> {
  if (!file.uploadKey.startsWith(`incoming/albums/${album.slug}/`)) {
    throw new Error("Invalid album upload key");
  }
  if (!isSafePhotoId(file.photoId)) throw new Error("Invalid photo id");
  const uploaded = await headObject(file.uploadKey, { scope: "private" });
  if (!uploaded.exists || !uploaded.size || uploaded.size > MAX_ALBUM_FILE_BYTES) {
    throw new Error("Uploaded album image failed verification");
  }
  const raw = await downloadBuffer(file.uploadKey, { scope: "private" });
  const extension = path.extname(file.original).toLowerCase() || ".jpg";
  const overlay: OgOverlay = { title: album.title, photoId: file.photoId };
  const [processed, responsive] = await Promise.all([
    processAlbumSource(raw, extension, undefined, overlay),
    processResponsiveImage(raw, extension),
  ]);
  const prefix = `albums/${album.slug}`;
  await Promise.all([
    ...responsive.variants.flatMap((variant) =>
      (["avif", "webp"] as const).map((format) => {
        const output = variant.formats[format];
        return uploadBuffer(
          `${prefix}/images/${file.photoId}/${variant.width}.${format}`,
          output.buffer,
          output.contentType,
          { scope: "private", cacheControl: PRIVATE_MEDIA_CACHE_CONTROL },
        );
      }),
    ),
    uploadBuffer(
      `${prefix}/original/${file.photoId}.jpg`,
      processed.original.buffer,
      processed.original.contentType,
      { scope: "private", cacheControl: PRIVATE_MEDIA_CACHE_CONTROL },
    ),
    uploadBuffer(
      `${prefix}/og/${file.photoId}.jpg`,
      processed.og.buffer,
      processed.og.contentType,
      {
        scope: "private",
        cacheControl: PRIVATE_MEDIA_CACHE_CONTROL,
      },
    ),
  ]);
  return {
    id: file.photoId,
    width: responsive.width,
    height: responsive.height,
    version: responsive.version,
    widths: responsive.variants.map((variant) => variant.width),
    placeholder: responsive.placeholder,
    size: processed.original.buffer.byteLength,
    ...(processed.takenAt ? { takenAt: processed.takenAt } : {}),
  };
}

async function finalizeAlbumUploads(
  slug: string,
  files: Array<Pick<PreparedAlbumUpload, "original" | "photoId" | "uploadKey">>,
): Promise<{ album: AdminAlbum; added: Photo[] }> {
  const album = await readAlbumManifest(slug);
  if (!album) throw new Error("Album not found");
  if (!files.length || files.length > MAX_ALBUM_FILES) {
    throw new Error(`Choose between 1 and ${MAX_ALBUM_FILES} images`);
  }
  if (album.photos.length + files.length > MAX_ALBUM_FILES) {
    throw new Error(`An album can contain at most ${MAX_ALBUM_FILES} images`);
  }
  const incomingIds = new Set<string>();
  const existingIds = new Set(album.photos.map((photo) => photo.id));
  for (const file of files) {
    if (
      !file ||
      typeof file !== "object" ||
      typeof file.original !== "string" ||
      typeof file.photoId !== "string" ||
      typeof file.uploadKey !== "string" ||
      !isProcessableImage(file.original) ||
      !isSafePhotoId(file.photoId) ||
      !file.uploadKey.startsWith(`incoming/albums/${slug}/`)
    ) {
      throw new Error("Invalid uploaded image");
    }
    if (existingIds.has(file.photoId) || incomingIds.has(file.photoId)) {
      throw new Error(`Photo ID already exists: ${file.photoId}`);
    }
    incomingIds.add(file.photoId);
  }

  try {
    const added = await mapConcurrent(files, 2, (file) => processAlbumUpload(album, file));
    const latest = await readAlbumManifest(slug);
    if (!latest) throw new Error("Album not found");
    if (latest.photos.length + added.length > MAX_ALBUM_FILES) {
      throw new Error(`An album can contain at most ${MAX_ALBUM_FILES} images`);
    }
    const latestIds = new Set(latest.photos.map((photo) => photo.id));
    if (added.some((photo) => latestIds.has(photo.id))) {
      throw new Error("A photo with the same ID was added during processing");
    }
    const wasPublished = latest.status !== "draft";
    const previousPublishedAlbum = wasPublished ? { ...latest, photos: [...latest.photos] } : null;
    latest.photos.push(...added);
    if (!latest.cover && added[0]) latest.cover = added[0].id;
    latest.status = "draft";
    if (previousPublishedAlbum) await unpublishAlbumAssets(previousPublishedAlbum);
    try {
      const updated = await writeAlbumManifest(latest);
      return { album: toAdminAlbum(updated), added };
    } catch (error) {
      if (previousPublishedAlbum) {
        await publishAlbumAssets(previousPublishedAlbum).catch(() => undefined);
      }
      throw error;
    }
  } finally {
    await deleteObjects(
      files.map((file) => file.uploadKey),
      { scope: "private" },
    ).catch(() => 0);
  }
}

export {
  createAdminAlbum,
  deleteAlbum,
  deleteAlbumPhoto,
  deleteAlbumPhotos,
  finalizeAlbumUploads,
  isSafeAlbumSlug,
  isSafePhotoId,
  isValidAlbumDate,
  listAdminAlbums,
  normaliseSlug,
  normalisePhotoId,
  prepareAlbumUploads,
  reorderAlbumPhotos,
  setAlbumCover,
  updateAlbumMetadata,
  updateAlbumPhoto,
};
export type { AdminAlbum, AlbumUploadInput, PreparedAlbumUpload };
