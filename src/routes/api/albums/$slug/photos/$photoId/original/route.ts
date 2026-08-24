import { createFileRoute } from "@tanstack/react-router";

import { buildAttachmentContentDisposition } from "@/features/downloads/presign";
import { getAlbumBySlug } from "@/features/media/albums.server";
import { isSafeAlbumSlug, isSafePhotoId } from "@/features/media/admin-albums";
import { presignGetUrl } from "@/lib/platform/r2.server";
import { PRIVATE_MEDIA_CACHE_CONTROL } from "@/lib/shared/media-cache";

async function handleGET(slug: string, photoId: string) {
  if (!isSafeAlbumSlug(slug) || !isSafePhotoId(photoId)) {
    return Response.json({ error: "Photo not found" }, { status: 404 });
  }
  const album = await getAlbumBySlug(slug);
  if (!album?.photos.some((photo) => photo.id === photoId)) {
    return Response.json({ error: "Photo not found" }, { status: 404 });
  }

  const location = await presignGetUrl(`albums/${slug}/original/${photoId}.jpg`, {
    scope: "private",
    expiresIn: 60 * 60,
    responseCacheControl: PRIVATE_MEDIA_CACHE_CONTROL,
    responseContentDisposition: buildAttachmentContentDisposition(`${photoId}.jpg`),
    responseContentType: "application/octet-stream",
  });
  return new Response(null, {
    status: 307,
    headers: {
      Location: location,
      "Cache-Control": PRIVATE_MEDIA_CACHE_CONTROL,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const Route = createFileRoute("/api/albums/$slug/photos/$photoId/original")({
  server: {
    handlers: {
      GET: ({ params }) => handleGET(params.slug, params.photoId),
      HEAD: ({ params }) => handleGET(params.slug, params.photoId),
    },
  },
});

export { handleGET as GET };
