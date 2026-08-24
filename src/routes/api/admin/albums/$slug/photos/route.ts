import { createFileRoute } from "@tanstack/react-router";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { deleteAlbumPhotos, isSafeAlbumSlug } from "@/features/media/admin-albums";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleDELETE(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;
  if (!isSafeAlbumSlug(slug))
    return Response.json({ error: "Invalid album slug" }, { status: 400 });
  try {
    const body = (await request.json()) as { photoIds?: unknown };
    if (!Array.isArray(body.photoIds) || !body.photoIds.every((id) => typeof id === "string")) {
      return Response.json({ error: "photoIds must be a list of photo IDs" }, { status: 400 });
    }
    const result = await deleteAlbumPhotos(slug, body.photoIds);
    return Response.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete photos";
    if (message === "Album not found") return Response.json({ error: message }, { status: 404 });
    if (message === "No matching photos found") {
      return Response.json({ error: message }, { status: 400 });
    }
    return apiErrorFromRequest(
      request,
      "admin.albums.photos.delete",
      "Failed to delete photos",
      error,
      {
        slug,
      },
    );
  }
}

export const Route = createFileRoute("/api/admin/albums/$slug/photos")({
  server: { handlers: { DELETE: ({ request, params }) => handleDELETE(request, params.slug) } },
});
