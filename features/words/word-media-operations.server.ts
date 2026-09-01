import { buildAttachmentContentDisposition } from "@/features/downloads/presign";
import type { FileKind } from "@/features/media/file-kinds";
import type { ResponsiveImageMetadata } from "@/features/media/image";
import {
  RawPreviewUnavailableError,
  getFileKind,
  getMimeType,
  isProcessableImage,
  processResponsiveImage,
} from "@/features/media/processing.server";
import {
  copyObject,
  deleteObject,
  downloadBuffer,
  headObject,
  uploadBuffer,
} from "@/lib/platform/object-storage-provider-context.server";
import type { StorageScope } from "@/lib/platform/r2.server";
import {
  MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL,
  PRIVATE_MEDIA_CACHE_CONTROL,
  VERSIONED_PUBLIC_MEDIA_CACHE_CONTROL,
} from "@/lib/shared/media-cache";
import { wordImageVariantKey } from "./image";
import { mergeWordImageMetadata, pruneWordImageVariants } from "./image.server";
import {
  incomingMediaPrefixForTarget,
  isRawWordUpload,
  mediaPathForTarget,
  toMarkdownSnippetForTarget,
  toR2Filename,
  type WordMediaTarget,
} from "./upload";

export interface WordMediaFinalizeFile {
  original: string;
  filename: string;
  uploadKey: string;
  size: number;
  kind: FileKind;
  overwrote: boolean;
}

interface ProcessedWordMediaFile {
  original: string;
  filename: string;
  kind: FileKind;
  width?: number;
  height?: number;
  size: number;
  markdown: string;
  overwrote: boolean;
  image?: ResponsiveImageMetadata;
}

export interface WordMediaFinalizeSuccess {
  uploaded: Array<Omit<ProcessedWordMediaFile, "image">>;
  skipped: string[];
  queuedCount: number;
}

export async function verifyWordMediaFile(file: WordMediaFinalizeFile): Promise<string | null> {
  const object = await headObject(file.uploadKey, { scope: "private" });
  if (!object.exists || object.size !== file.size) {
    return `Uploaded file verification failed: ${file.original}`;
  }
  const expectedContentType = getMimeType(file.original);
  return object.contentType && object.contentType !== expectedContentType
    ? `Uploaded file type did not match: ${file.original}`
    : null;
}

async function processImage(
  target: WordMediaTarget,
  storageScope: StorageScope,
  file: WordMediaFinalizeFile,
): Promise<ProcessedWordMediaFile> {
  const original = file.original.trim();
  const raw = await downloadBuffer(file.uploadKey, { scope: "private" });
  const webpFilename = toR2Filename(original);
  const webpKey = mediaPathForTarget(target, webpFilename);

  try {
    const image = await processResponsiveImage(raw, original);
    const largest = image.variants.at(-1);
    if (!largest) throw new Error(`No responsive variants generated for ${original}`);
    await Promise.all([
      uploadBuffer(webpKey, largest.formats.webp.buffer, "image/webp", {
        scope: storageScope,
        cacheControl:
          storageScope === "public"
            ? MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL
            : PRIVATE_MEDIA_CACHE_CONTROL,
      }),
      ...image.variants.flatMap((variant) =>
        (["avif", "webp"] as const).map((format) => {
          const output = variant.formats[format];
          return uploadBuffer(
            wordImageVariantKey(target, webpFilename, variant.width, format),
            output.buffer,
            output.contentType,
            {
              scope: storageScope,
              cacheControl:
                storageScope === "public"
                  ? VERSIONED_PUBLIC_MEDIA_CACHE_CONTROL
                  : PRIVATE_MEDIA_CACHE_CONTROL,
            },
          );
        }),
      ),
    ]);
    await pruneWordImageVariants(
      target,
      webpFilename,
      image.variants.map((variant) => variant.width),
      storageScope,
    );
    return {
      original,
      filename: webpFilename,
      kind: "image",
      width: image.width,
      height: image.height,
      size: largest.formats.webp.buffer.byteLength,
      markdown: toMarkdownSnippetForTarget(target, webpFilename, "image"),
      overwrote: file.overwrote,
      image: {
        width: image.width,
        height: image.height,
        version: image.version,
        widths: image.variants.map((variant) => variant.width),
        placeholder: image.placeholder,
      },
    };
  } catch (error) {
    if (!(error instanceof RawPreviewUnavailableError) || !isRawWordUpload(original)) throw error;
    const filename = toR2Filename(original, { preserveRawExtension: true });
    await uploadBuffer(mediaPathForTarget(target, filename), raw, getMimeType(original), {
      scope: storageScope,
      cacheControl:
        storageScope === "public"
          ? MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL
          : PRIVATE_MEDIA_CACHE_CONTROL,
      contentDisposition: buildAttachmentContentDisposition(filename),
    });
    return {
      original,
      filename,
      kind: "file",
      size: raw.byteLength,
      markdown: toMarkdownSnippetForTarget(target, filename, "file"),
      overwrote: file.overwrote,
    };
  }
}

export async function processWordMediaFile(
  target: WordMediaTarget,
  storageScope: StorageScope,
  file: WordMediaFinalizeFile,
): Promise<ProcessedWordMediaFile> {
  if (isProcessableImage(file.original)) return processImage(target, storageScope, file);

  const original = file.original.trim();
  const kind = file.kind ?? getFileKind(original);
  await copyObject(file.uploadKey, mediaPathForTarget(target, file.filename), {
    sourceScope: "private",
    destinationScope: storageScope,
    contentType: getMimeType(original),
    cacheControl:
      storageScope === "public" ? MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL : PRIVATE_MEDIA_CACHE_CONTROL,
    contentDisposition: buildAttachmentContentDisposition(file.filename),
  });
  return {
    original,
    filename: file.filename,
    kind,
    size: file.size,
    markdown: toMarkdownSnippetForTarget(target, file.filename, kind),
    overwrote: file.overwrote,
  };
}

export async function finishWordMediaMetadata(
  target: WordMediaTarget,
  storageScope: StorageScope,
  processed: ProcessedWordMediaFile[],
): Promise<WordMediaFinalizeSuccess> {
  const imageEntries = Object.fromEntries(
    processed.flatMap((file) => (file.image ? [[file.filename, file.image]] : [])),
  );
  if (Object.keys(imageEntries).length > 0) {
    await mergeWordImageMetadata(target, imageEntries, storageScope);
  }
  return {
    uploaded: processed.map(({ image: _image, ...file }) => file),
    skipped: [],
    queuedCount: 0,
  };
}

export async function cleanupWordMediaStagingFile(
  target: WordMediaTarget,
  file: WordMediaFinalizeFile,
): Promise<void> {
  const prefix = incomingMediaPrefixForTarget(target);
  if (!file.uploadKey.startsWith(prefix) || file.uploadKey.includes("..")) return;
  await deleteObject(file.uploadKey, { scope: "private" });
}
