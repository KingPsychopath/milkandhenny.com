import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { requireAuthWithPayload } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { isConfigured } from "@/lib/platform/r2.server";
import {
  MAX_WORD_MEDIA_FILE_BYTES,
  MAX_WORD_MEDIA_FILES,
  getWordUploadFilenameCandidates,
  incomingMediaPrefixForTarget,
  parseWordMediaTarget,
} from "@/features/words/upload";
import type { FileKind } from "@/features/media/file-kinds";
import { FILE_KINDS } from "@/features/media/file-kinds";
import { WordMediaService } from "@/features/words/word-media-service.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
export const maxDuration = 120;

type FinalizeFile = {
  original: string;
  filename: string;
  uploadKey: string;
  size: number;
  kind: FileKind;
  overwrote: boolean;
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
    const result = await runMediaEffect(
      Effect.gen(function* () {
        const media = yield* WordMediaService;
        return yield* media.finalize({ target, files, skipped });
      }),
      request.signal,
    );
    return result.status === "completed"
      ? Response.json(result.value)
      : Response.json({ error: result.error }, { status: 400 });
  } catch (e) {
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
