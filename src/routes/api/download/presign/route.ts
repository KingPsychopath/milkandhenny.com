import { createFileRoute } from "@tanstack/react-router";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { isConfigured, isTransferStorageConfigured, presignGetUrl } from "@/lib/platform/r2.server";
import {
  buildAttachmentContentDisposition,
  deriveDownloadFilename,
  isAllowedDownloadStorageKey,
} from "@/features/downloads/presign";
import { transferContainsStorageKey } from "@/features/transfers/media-access";
import { getTransfer } from "@/features/transfers/store.server";
import { getAlbumBySlug } from "@/features/media/albums.server";
import { PRIVATE_MEDIA_CACHE_CONTROL } from "@/lib/shared/media-cache";

const DOWNLOAD_URL_TTL_SECONDS = 3600;
const DOWNLOAD_RESPONSE_CONTENT_TYPE = "application/octet-stream";

export const runtime = "nodejs";

async function handleGET(request: Request) {
  if (!isConfigured()) {
    return Response.json(
      { error: "R2 storage is not configured. Add R2 env vars." },
      { status: 503 },
    );
  }

  const key = new URL(request.url).searchParams.get("key")?.trim() ?? "";
  const requestedFilename = new URL(request.url).searchParams.get("filename");

  if (!isAllowedDownloadStorageKey(key)) {
    return Response.json({ error: "Invalid download key." }, { status: 400 });
  }

  if (key.startsWith("transfers/")) {
    if (!isTransferStorageConfigured()) {
      return Response.json(
        { error: "Private transfer storage is not configured." },
        { status: 503 },
      );
    }
    const transferId = key.split("/")[1] ?? "";
    const transfer = await getTransfer(transferId);
    if (
      !transfer ||
      new Date(transfer.expiresAt).getTime() <= Date.now() ||
      !transferContainsStorageKey(transfer, key)
    ) {
      return Response.json({ error: "Transfer file not found or expired." }, { status: 404 });
    }
  }

  if (key.startsWith("albums/")) {
    const [, slug, , file] = key.split("/");
    const photoId = file?.replace(/\.jpe?g$/i, "") ?? "";
    const album = slug ? await getAlbumBySlug(slug) : null;
    if (!album?.photos.some((photo) => photo.id === photoId)) {
      return Response.json({ error: "Album photo not found." }, { status: 404 });
    }
  }

  const filename = deriveDownloadFilename(key, requestedFilename);
  if (!filename) {
    return Response.json({ error: "Invalid download filename." }, { status: 400 });
  }

  try {
    const url = await presignGetUrl(key, {
      responseContentDisposition: buildAttachmentContentDisposition(filename),
      responseContentType: DOWNLOAD_RESPONSE_CONTENT_TYPE,
      responseCacheControl: PRIVATE_MEDIA_CACHE_CONTROL,
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
      scope: "private",
    });

    return Response.json({ url });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "download.presign",
      "Failed to prepare download URL. Please try again.",
      error,
      { key },
    );
  }
}

export const Route = createFileRoute("/api/download/presign")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
    },
  },
});

export { handleGET as GET };
