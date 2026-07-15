import { createFileRoute } from "@tanstack/react-router";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { isConfigured, presignGetUrl } from "@/lib/platform/r2.server";
import {
  buildAttachmentContentDisposition,
  deriveDownloadFilename,
  isAllowedDownloadStorageKey,
} from "@/features/downloads/presign";

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

  const filename = deriveDownloadFilename(key, requestedFilename);
  if (!filename) {
    return Response.json({ error: "Invalid download filename." }, { status: 400 });
  }

  try {
    const url = await presignGetUrl(key, {
      responseContentDisposition: buildAttachmentContentDisposition(filename),
      responseContentType: DOWNLOAD_RESPONSE_CONTENT_TYPE,
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
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
