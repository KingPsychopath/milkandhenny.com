import { createFileRoute } from "@tanstack/react-router";
import { requireAuthWithPayload } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import {
  copyObject,
  deleteObject,
  downloadBuffer,
  headObject,
  isConfigured,
  uploadBuffer,
} from "@/lib/platform/r2.server";
import {
  RawPreviewUnavailableError,
  getMimeType,
  isProcessableImage,
  processResponsiveImage,
} from "@/features/media/processing.server";
import {
  MAX_WORD_MEDIA_FILE_BYTES,
  MAX_WORD_MEDIA_FILES,
  getWordUploadFilenameCandidates,
  incomingMediaPrefixForTarget,
  isRawWordUpload,
  mediaPathForTarget,
  parseWordMediaTarget,
  toR2Filename,
  toMarkdownSnippetForTarget,
} from "@/features/words/upload";
import { getFileKind } from "@/features/media/processing.server";
import type { FileKind } from "@/features/media/file-kinds";
import { FILE_KINDS } from "@/features/media/file-kinds";
import { mapWithConcurrency } from "@/lib/shared/map-with-concurrency";
import { getWordMediaStorageScope } from "@/features/words/media-storage.server";
import { wordImageVariantKey } from "@/features/words/image";
import { mergeWordImageMetadata, pruneWordImageVariants } from "@/features/words/image.server";
import type { ResponsiveImageMetadata } from "@/features/media/image";
import {
  MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL,
  PRIVATE_MEDIA_CACHE_CONTROL,
  VERSIONED_PUBLIC_MEDIA_CACHE_CONTROL,
} from "@/lib/shared/media-cache";
import { buildAttachmentContentDisposition } from "@/features/downloads/presign";
export const maxDuration = 15;
const FINALIZE_CONCURRENCY = 2;

type FinalizeFile = {
  original: string;
  filename: string;
  uploadKey: string;
  size: number;
  kind: FileKind;
  overwrote: boolean;
};

type FinalizeSuccess = {
  uploaded: Array<{
    original: string;
    filename: string;
    kind: FileKind;
    width?: number;
    height?: number;
    size: number;
    markdown: string;
    overwrote: boolean;
  }>;
  skipped: string[];
  queuedCount: number;
};

const SAFE_WORD_FILENAME = /^[a-z0-9-]+\.[a-z0-9]{1,8}$/;
function isSafeUploadKey(incomingPrefix: string, uploadKey: string): boolean {
  if (!uploadKey.startsWith(incomingPrefix)) {
    return false;
  }
  if (uploadKey.includes("..")) return false;
  return true;
}

/**
 * POST /api/upload/words/finalize
 *
 * Step 2 of the words media presigned upload flow.
 * Images are downloaded from R2, converted to WebP, and saved to the final target path.
 * Non-images are promoted from private staging to their final storage scope.
 *
 * Body: { scope?: "word"|"asset", slug?, assetId?, files: FinalizeFile[], skipped?: string[] }
 * Returns: { uploaded: UploadedWordFile[], skipped: string[] }
 */
async function handlePOST(request: Request) {
  const { error: authErr } = await requireAuthWithPayload(request, "admin");
  if (authErr) return authErr;

  if (!isConfigured()) {
    return Response.json(
      { error: "R2 storage is not configured. Add R2 env vars." },
      { status: 503 },
    );
  }

  let body: {
    scope?: string;
    slug?: string;
    assetId?: string;
    files?: FinalizeFile[];
    skipped?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const targetResult = parseWordMediaTarget({
    scope: body.scope,
    slug: body.slug,
    assetId: body.assetId,
  });
  if (!targetResult.ok) {
    return Response.json({ error: targetResult.error }, { status: 400 });
  }
  const target = targetResult.target;
  const incomingPrefix = incomingMediaPrefixForTarget(target);
  const storageScope = await getWordMediaStorageScope(target);
  const files = body.files;
  const skipped = Array.isArray(body.skipped)
    ? body.skipped
        .filter((value): value is string => typeof value === "string" && value.length <= 255)
        .slice(0, MAX_WORD_MEDIA_FILES)
    : [];

  if (!Array.isArray(files) || files.length > MAX_WORD_MEDIA_FILES) {
    return Response.json({ error: "No files provided" }, { status: 400 });
  }
  if (files.length === 0) {
    return Response.json({ uploaded: [], skipped });
  }

  const destinationNames = new Set<string>();
  for (const file of files) {
    if (
      !file ||
      typeof file.original !== "string" ||
      !file.original.trim() ||
      file.original.length > 255
    ) {
      return Response.json({ error: "Each file must include original" }, { status: 400 });
    }
    if (
      !file.filename ||
      typeof file.filename !== "string" ||
      !SAFE_WORD_FILENAME.test(file.filename)
    ) {
      return Response.json({ error: "Each file must include a safe filename" }, { status: 400 });
    }
    const filenameCandidates = getWordUploadFilenameCandidates(file.original);
    if (!filenameCandidates.includes(file.filename)) {
      return Response.json(
        { error: `Destination filename did not match: ${file.original}` },
        { status: 400 },
      );
    }
    if (filenameCandidates.some((candidate) => destinationNames.has(candidate))) {
      return Response.json(
        { error: `Duplicate destination filename: ${file.filename}` },
        { status: 400 },
      );
    }
    for (const candidate of filenameCandidates) destinationNames.add(candidate);
    if (
      !file.uploadKey ||
      typeof file.uploadKey !== "string" ||
      !isSafeUploadKey(incomingPrefix, file.uploadKey)
    ) {
      return Response.json({ error: "Each file must include a safe uploadKey" }, { status: 400 });
    }
    if (!Number.isFinite(file.size) || file.size < 0) {
      return Response.json({ error: "Each file must include a valid size" }, { status: 400 });
    }
    if (file.size > MAX_WORD_MEDIA_FILE_BYTES) {
      return Response.json({ error: `${file.original} is larger than 100 MB` }, { status: 400 });
    }
    if (!FILE_KINDS.includes(file.kind)) {
      return Response.json({ error: `Invalid file kind: ${file.original}` }, { status: 400 });
    }
  }

  try {
    const uploadedObjects = await mapWithConcurrency(files, FINALIZE_CONCURRENCY, async (file) => ({
      file,
      object: await headObject(file.uploadKey, { scope: "private" }),
    }));
    for (const { file, object } of uploadedObjects) {
      if (!object.exists || object.size !== file.size) {
        return Response.json(
          { error: `Uploaded file verification failed: ${file.original}` },
          { status: 400 },
        );
      }
      const expectedContentType = getMimeType(file.original);
      if (object.contentType && object.contentType !== expectedContentType) {
        return Response.json(
          { error: `Uploaded file type did not match: ${file.original}` },
          { status: 400 },
        );
      }
    }

    const processed = await mapWithConcurrency(files, FINALIZE_CONCURRENCY, async (file) => {
      const original = file.original.trim();

      if (isProcessableImage(original)) {
        // Uploaded to a temp key → download → process → upload to final key → delete temp key.
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

          try {
            await deleteObject(file.uploadKey, { scope: "private" });
          } catch {
            // Best-effort cleanup. The temp file is not referenced by markdown and can be cleaned manually.
          }

          return {
            original,
            filename: webpFilename,
            kind: "image" as const,
            width: image.width,
            height: image.height,
            size: largest.formats.webp.buffer.byteLength,
            markdown: toMarkdownSnippetForTarget(target, webpFilename, "image"),
            overwrote: !!file.overwrote,
            image: {
              width: image.width,
              height: image.height,
              version: image.version,
              widths: image.variants.map((variant) => variant.width),
              placeholder: image.placeholder,
            } satisfies ResponsiveImageMetadata,
          };
        } catch (error) {
          if (!(error instanceof RawPreviewUnavailableError) || !isRawWordUpload(original)) {
            throw error;
          }

          const fallbackFilename = toR2Filename(original, { preserveRawExtension: true });
          const fallbackKey = mediaPathForTarget(target, fallbackFilename);
          const fallbackKind: FileKind = "file";
          await uploadBuffer(fallbackKey, raw, getMimeType(original), {
            scope: storageScope,
            cacheControl:
              storageScope === "public"
                ? MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL
                : PRIVATE_MEDIA_CACHE_CONTROL,
            contentDisposition: buildAttachmentContentDisposition(fallbackFilename),
          });

          try {
            await deleteObject(file.uploadKey, { scope: "private" });
          } catch {
            // Best-effort cleanup. The temp file is not referenced by markdown and can be cleaned manually.
          }

          return {
            original,
            filename: fallbackFilename,
            kind: fallbackKind,
            size: raw.byteLength,
            markdown: toMarkdownSnippetForTarget(target, fallbackFilename, fallbackKind),
            overwrote: !!file.overwrote,
          };
        }
      }

      const kind = file.kind ?? getFileKind(original);
      const finalKey = mediaPathForTarget(target, file.filename);
      await copyObject(file.uploadKey, finalKey, {
        sourceScope: "private",
        destinationScope: storageScope,
        contentType: getMimeType(original),
        cacheControl:
          storageScope === "public"
            ? MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL
            : PRIVATE_MEDIA_CACHE_CONTROL,
        contentDisposition: buildAttachmentContentDisposition(file.filename),
      });
      await deleteObject(file.uploadKey, { scope: "private" });
      return {
        original,
        filename: file.filename,
        kind,
        size: file.size,
        markdown: toMarkdownSnippetForTarget(target, file.filename, kind),
        overwrote: !!file.overwrote,
      };
    });

    const imageEntries = Object.fromEntries(
      processed.flatMap((file) =>
        "image" in file && file.image ? [[file.filename, file.image]] : [],
      ),
    );
    if (Object.keys(imageEntries).length > 0) {
      await mergeWordImageMetadata(target, imageEntries, storageScope);
    }
    const uploaded = processed.map((file) => {
      if (!("image" in file)) return file;
      const { image: _image, ...result } = file;
      return result;
    });

    const payload: FinalizeSuccess = { uploaded, skipped, queuedCount: 0 };
    return Response.json(payload);
  } catch (e) {
    const incomingKeys = files
      .map((file) => file.uploadKey)
      .filter(
        (key): key is string =>
          typeof key === "string" &&
          key.startsWith(incomingPrefix) &&
          isSafeUploadKey(incomingPrefix, key),
      );
    await Promise.all(
      incomingKeys.map(async (key) => {
        try {
          await deleteObject(key, { scope: "private" });
        } catch {
          // Best-effort temp cleanup after finalize failure.
        }
      }),
    );

    return apiErrorFromRequest(
      request,
      "upload.words.finalize",
      "Failed to finalize words upload. Files may have uploaded but could not be processed.",
      e,
    );
  }
}

export const Route = createFileRoute("/api/upload/words/finalize")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
    },
  },
});

export { handlePOST as POST };
