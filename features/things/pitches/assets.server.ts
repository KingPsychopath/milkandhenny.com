import path from "node:path";
import sharp from "sharp";

import {
  deleteObject,
  deleteObjects,
  downloadBuffer,
  headObject,
  presignGetUrl,
  presignPutUrl,
  uploadBuffer,
} from "@/lib/platform/r2.server";
import {
  PITCH_AUDIO_MAX_BYTES,
  PITCH_DECK_ASSET_MAX_BYTES,
  PITCH_IMAGE_MAX_BYTES,
  PITCH_THUMBNAIL_MAX_BYTES,
  PITCH_VIDEO_MAX_BYTES,
} from "./types";
import { PRIVATE_MEDIA_CACHE_CONTROL } from "@/lib/shared/media-cache";
import {
  createPitchAssetId,
  deletePitchAssetRecord,
  getPitchAsset,
  getReadyPitchAsset,
  insertPitchAsset,
  listPitchAssets,
  listReadyPitchAssets,
  listStalePendingPitchAssets,
  listUnreferencedPitchAssets,
  markPitchAssetReady,
  ownerCanAccessPitch,
  pitchAssetBytes,
  type PitchAssetRow,
  type PitchStoreResult,
  toPitchAsset,
} from "./store.server";
import type { PitchAsset, PitchAssetKind } from "./types";
import type { ResponsiveImageData, ResponsiveImageFormat } from "@/features/media/image";
import { getImageUrl } from "@/features/media/storage";

const PITCH_THUMBNAIL_WIDTHS = [480, 960] as const;
const PUBLIC_IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";

type PitchThumbnailMetadata = Pick<
  ResponsiveImageData,
  "height" | "placeholder" | "version" | "width" | "widths"
>;

function pitchThumbnailKey(
  deckId: string,
  assetId: string,
  width: number,
  format: ResponsiveImageFormat,
): string {
  return `pitches/${deckId}/thumbnails/${assetId}/${width}.${format}`;
}

function pitchThumbnailMetadataKey(deckId: string, assetId: string): string {
  return `pitches/${deckId}/thumbnails/${assetId}/metadata.json`;
}

function rgbHex(rgb: { r: number; g: number; b: number }): string {
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

async function createPitchThumbnailVariants(row: PitchAssetRow): Promise<PitchThumbnailMetadata> {
  const source = await downloadBuffer(row.object_key, { scope: "private" });
  const image = sharp(source, { failOn: "error" }).rotate();
  const stats = await image.stats();
  const color = rgbHex(stats.dominant);
  const placeholder = await image
    .clone()
    .resize(24, 14, { fit: "cover" })
    .blur(1)
    .webp({ quality: 35 })
    .toBuffer();
  const metadata: PitchThumbnailMetadata = {
    width: 960,
    height: 540,
    widths: [...PITCH_THUMBNAIL_WIDTHS],
    version: row.id,
    placeholder: { color, blurDataUrl: `data:image/webp;base64,${placeholder.toString("base64")}` },
  };
  const uploads = PITCH_THUMBNAIL_WIDTHS.flatMap((width) => {
    const resized = image.clone().resize(width, Math.round((width * 9) / 16), {
      fit: "contain",
      background: color,
      withoutEnlargement: true,
    });
    return [
      resized
        .clone()
        .avif({ quality: 55, effort: 5 })
        .toBuffer()
        .then((buffer) =>
          uploadBuffer(
            pitchThumbnailKey(row.deck_id, row.id, width, "avif"),
            buffer,
            "image/avif",
            {
              scope: "public",
              cacheControl: PUBLIC_IMAGE_CACHE_CONTROL,
            },
          ),
        ),
      resized
        .webp({ quality: 78, effort: 5 })
        .toBuffer()
        .then((buffer) =>
          uploadBuffer(
            pitchThumbnailKey(row.deck_id, row.id, width, "webp"),
            buffer,
            "image/webp",
            {
              scope: "public",
              cacheControl: PUBLIC_IMAGE_CACHE_CONTROL,
            },
          ),
        ),
    ];
  });
  await Promise.all([
    ...uploads,
    uploadBuffer(
      pitchThumbnailMetadataKey(row.deck_id, row.id),
      Buffer.from(JSON.stringify(metadata)),
      "application/json",
      { scope: "public", cacheControl: PUBLIC_IMAGE_CACHE_CONTROL },
    ),
  ]);
  return metadata;
}

export async function signedPitchThumbnail(
  deckId: string,
  assetId: string,
): Promise<ResponsiveImageData | null> {
  const row = await getReadyPitchAsset(deckId, assetId);
  if (!row || row.kind !== "thumbnail") return null;
  const metadataKey = pitchThumbnailMetadataKey(deckId, assetId);
  const metadata = (await headObject(metadataKey, { scope: "public" })).exists
    ? (JSON.parse(
        (await downloadBuffer(metadataKey, { scope: "public" })).toString("utf8"),
      ) as PitchThumbnailMetadata)
    : await createPitchThumbnailVariants(row);
  const srcSetFor = (format: ResponsiveImageFormat) =>
    metadata.widths
      .map((width) => `${getImageUrl(pitchThumbnailKey(deckId, assetId, width, format))} ${width}w`)
      .join(", ");
  return {
    ...metadata,
    src: getImageUrl(pitchThumbnailKey(deckId, assetId, 960, "webp")),
    srcSet: srcSetFor("webp"),
    sources: [{ type: "image/avif", srcSet: srcSetFor("avif") }],
  };
}

const MIME_BY_KIND: Record<PitchAssetKind, ReadonlySet<string>> = {
  image: new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  thumbnail: new Set(["image/png", "image/jpeg", "image/webp"]),
  audio: new Set([
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
    "audio/wav",
    "audio/webm",
    "audio/x-m4a",
  ]),
  video: new Set(["video/mp4", "video/webm", "video/quicktime"]),
};

function maxBytes(kind: PitchAssetKind): number {
  switch (kind) {
    case "image":
      return PITCH_IMAGE_MAX_BYTES;
    case "audio":
      return PITCH_AUDIO_MAX_BYTES;
    case "video":
      return PITCH_VIDEO_MAX_BYTES;
    case "thumbnail":
      return PITCH_THUMBNAIL_MAX_BYTES;
  }
}

function safeFileName(value: string): string {
  const extension = path
    .extname(value)
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, "")
    .slice(0, 10);
  const stem = path
    .basename(value, path.extname(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${stem || "asset"}${extension || ".bin"}`;
}

async function withSignedUrl(row: PitchAssetRow): Promise<PitchAsset> {
  const url = await presignGetUrl(row.object_key, {
    expiresIn: row.kind === "audio" || row.kind === "video" ? 6 * 60 * 60 : 15 * 60,
    scope: "private",
    responseContentType: row.mime_type,
    responseContentDisposition: "inline",
    responseCacheControl: PRIVATE_MEDIA_CACHE_CONTROL,
  });
  return { ...toPitchAsset(row), url };
}

export async function createPitchAssetUpload(input: {
  deckId: string;
  ownerToken: string;
  fileId?: string;
  kind: PitchAssetKind;
  fileName: string;
  mimeType: string;
  bytes: number;
}): Promise<
  PitchStoreResult<{
    asset: PitchAsset;
    uploadUrl: string;
  }>
> {
  if (!(await ownerCanAccessPitch(input.deckId, input.ownerToken))) {
    return { ok: false, status: 404, error: "Pitch not found" };
  }
  if (!MIME_BY_KIND[input.kind].has(input.mimeType)) {
    return { ok: false, status: 400, error: "That file format is not supported" };
  }
  if (!Number.isInteger(input.bytes) || input.bytes < 1 || input.bytes > maxBytes(input.kind)) {
    return {
      ok: false,
      status: 413,
      error: `That ${input.kind} file is too large`,
    };
  }
  const used = await pitchAssetBytes(input.deckId);
  if (used + input.bytes > PITCH_DECK_ASSET_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      error: "This pitch has reached its media allowance",
    };
  }

  const id = createPitchAssetId();
  const fileName = safeFileName(input.fileName);
  const objectKey = `pitches/${input.deckId}/${input.kind}/${id}-${fileName}`;
  const row = await insertPitchAsset({
    id,
    deckId: input.deckId,
    objectKey,
    fileId: input.fileId,
    kind: input.kind,
    fileName,
    mimeType: input.mimeType,
    bytes: input.bytes,
  });
  try {
    const uploadUrl = await presignPutUrl(objectKey, input.mimeType, 5 * 60, {
      scope: "private",
    });
    return { ok: true, value: { asset: toPitchAsset(row), uploadUrl } };
  } catch (error) {
    await deletePitchAssetRecord(id);
    throw error;
  }
}

export async function finalisePitchAsset(input: {
  deckId: string;
  ownerToken: string;
  assetId: string;
}): Promise<PitchStoreResult<PitchAsset>> {
  if (!(await ownerCanAccessPitch(input.deckId, input.ownerToken))) {
    return { ok: false, status: 404, error: "Pitch not found" };
  }
  const asset = await getPitchAsset(input.deckId, input.assetId);
  const alreadyReady = asset?.state === "ready" ? asset : null;
  if (alreadyReady) return { ok: true, value: await withSignedUrl(alreadyReady) };

  const pending = asset?.state === "pending" ? asset : null;
  if (!pending) return { ok: false, status: 404, error: "Upload not found" };

  const object = await headObject(pending.object_key, { scope: "private" });
  if (
    !object.exists ||
    object.size !== Number(pending.bytes) ||
    object.contentType !== pending.mime_type
  ) {
    if (object.exists) {
      await deleteObject(pending.object_key, { scope: "private" }).catch(() => undefined);
    }
    await deletePitchAssetRecord(pending.id);
    return { ok: false, status: 409, error: "The uploaded file did not match its reservation" };
  }

  const ready = await markPitchAssetReady(pending.id);
  if (!ready) {
    const replay = await getReadyPitchAsset(input.deckId, pending.id);
    if (!replay) return { ok: false, status: 409, error: "Upload could not be finalised" };
    return { ok: true, value: await withSignedUrl(replay) };
  }
  return { ok: true, value: await withSignedUrl(ready) };
}

export async function signedPitchAssets(
  deckId: string,
  options?: { assetIds?: ReadonlySet<string> },
): Promise<PitchAsset[]> {
  const rows = await listReadyPitchAssets(deckId);
  const visible = rows.filter((row) => !options?.assetIds || options.assetIds.has(row.id));
  return Promise.all(visible.map(withSignedUrl));
}

export async function signedPitchAsset(
  deckId: string,
  assetId: string,
): Promise<PitchAsset | null> {
  const row = await getReadyPitchAsset(deckId, assetId);
  return row ? withSignedUrl(row) : null;
}

export async function adminPitchAssets(deckId: string): Promise<PitchAsset[]> {
  const rows = await listPitchAssets(deckId);
  return Promise.all(
    rows.map((row) =>
      row.state === "ready" ? withSignedUrl(row) : Promise.resolve(toPitchAsset(row)),
    ),
  );
}

export async function cleanupStalePitchAssets(limit = 100): Promise<{
  attempted: number;
  deleted: number;
  failed: number;
}> {
  const rows = await listStalePendingPitchAssets(limit);
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await deleteObject(row.object_key, { scope: "private" });
      await deletePitchAssetRecord(row.id);
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { attempted: rows.length, deleted, failed };
}

export async function cleanupUnreferencedPitchAssets(limit = 100): Promise<{
  attempted: number;
  deleted: number;
  failed: number;
}> {
  const rows = await listUnreferencedPitchAssets(limit);
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await deleteObject(row.object_key, { scope: "private" });
      await deletePitchAssetRecord(row.id);
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { attempted: rows.length, deleted, failed };
}

export async function deleteAllPitchAssets(deckId: string): Promise<number> {
  const rows = await listPitchAssets(deckId);
  // Pending reservations may already have bytes in R2 even when
  // finalisation never completed.
  const privateDeleted = await deleteObjects(
    rows.map((row) => row.object_key),
    { scope: "private" },
  );
  const thumbnailKeys = rows
    .filter((row) => row.kind === "thumbnail")
    .flatMap((row) => [
      ...PITCH_THUMBNAIL_WIDTHS.flatMap((width) => [
        pitchThumbnailKey(deckId, row.id, width, "avif"),
        pitchThumbnailKey(deckId, row.id, width, "webp"),
      ]),
      pitchThumbnailMetadataKey(deckId, row.id),
    ]);
  const publicDeleted = await deleteObjects(thumbnailKeys, { scope: "public" });
  return privateDeleted + publicDeleted;
}
