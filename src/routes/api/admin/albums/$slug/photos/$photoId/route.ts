import { createFileRoute } from "@tanstack/react-router";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { deleteAlbumPhoto, isSafeAlbumSlug } from "@/features/media/admin-albums";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

type RouteContext = {
  params: Promise<{ slug: string; photoId: string }>;
};

async function handleDELETE(request: Request, context: RouteContext) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  const { slug, photoId } = await context.params;
  if (!isSafeAlbumSlug(slug)) {
    return Response.json({ error: "Invalid album slug" }, { status: 400 });
  }
  if (!photoId || typeof photoId !== "string") {
    return Response.json({ error: "Invalid photo id" }, { status: 400 });
  }

  try {
    const result = await deleteAlbumPhoto(slug, decodeURIComponent(photoId));
    return Response.json({ success: true, ...result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to delete photo";
    if (msg === "Album not found" || msg === "Photo not found in album") {
      return Response.json({ error: msg }, { status: 404 });
    }
    if (
      msg === "Invalid album slug" ||
      msg === "Invalid photo id" ||
      msg === "Cannot delete the last photo. Delete the album instead."
    ) {
      return Response.json({ error: msg }, { status: 400 });
    }
    return apiErrorFromRequest(
      request,
      "admin.albums.photo.delete",
      "Failed to delete photo",
      error,
      { slug, photoId },
    );
  }
}

export const Route = createFileRoute("/api/admin/albums/$slug/photos/$photoId")({
  server: {
    handlers: {
      DELETE: ({ request, params }) => handleDELETE(request, { params: Promise.resolve(params) }),
    },
  },
});
