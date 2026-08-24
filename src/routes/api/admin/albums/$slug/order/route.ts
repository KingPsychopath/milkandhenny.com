import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { isSafeAlbumSlug, reorderAlbumPhotos } from "@/features/media/admin-albums";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handlePATCH(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  if (!isSafeAlbumSlug(slug))
    return Response.json({ error: "Invalid album slug" }, { status: 400 });
  try {
    const body = (await request.json()) as { photoIds?: unknown };
    if (!Array.isArray(body.photoIds) || !body.photoIds.every((id) => typeof id === "string")) {
      return Response.json({ error: "photoIds must be a list of photo IDs" }, { status: 400 });
    }
    const album = await reorderAlbumPhotos(slug, body.photoIds);
    return Response.json({ success: true, album });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reorder photos";
    if (message === "Album not found") return Response.json({ error: message }, { status: 404 });
    if (message.startsWith("Photo order"))
      return Response.json({ error: message }, { status: 400 });
    return apiErrorFromRequest(request, "admin.albums.order", "Failed to reorder photos", error, {
      slug,
    });
  }
}

export const Route = createFileRoute("/api/admin/albums/$slug/order")({
  server: { handlers: { PATCH: ({ request, params }) => handlePATCH(request, params.slug) } },
});
