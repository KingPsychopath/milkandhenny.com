import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { isSafeAlbumSlug, isSafePhotoId } from "@/features/media/admin-albums";
import { readAlbumManifest } from "@/features/media/album-repository.server";
import { presignGetUrl } from "@/lib/platform/r2.server";
import { PRIVATE_MEDIA_CACHE_CONTROL } from "@/lib/shared/media-cache";

async function handleGET(request: Request, slug: string, photoId: string) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  if (!isSafeAlbumSlug(slug) || !isSafePhotoId(photoId)) {
    return Response.json({ error: "Photo not found" }, { status: 404 });
  }

  const album = await readAlbumManifest(slug);
  const photo = album?.photos.find((item) => item.id === photoId);
  const width = photo?.widths.at(-1);
  if (!photo || !width) return Response.json({ error: "Photo not found" }, { status: 404 });

  const key = `albums/${slug}/images/${photoId}/${width}.webp`;
  const location = await presignGetUrl(key, {
    scope: "private",
    expiresIn: 5 * 60,
    responseCacheControl: PRIVATE_MEDIA_CACHE_CONTROL,
    responseContentType: "image/webp",
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

export const Route = createFileRoute("/api/admin/albums/$slug/photos/$photoId/media")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, params.slug, params.photoId),
    },
  },
});

export { handleGET as GET };
