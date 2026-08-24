import { createFileRoute } from "@tanstack/react-router";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { deleteAlbum, isSafeAlbumSlug, updateAlbumMetadata } from "@/features/media/admin-albums";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

async function handleDELETE(request: Request, context: RouteContext) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  const { slug } = await context.params;
  if (!isSafeAlbumSlug(slug)) {
    return Response.json({ error: "Invalid album slug" }, { status: 400 });
  }

  try {
    const result = await deleteAlbum(slug);
    if (!result.deletedManifest) {
      return Response.json({ error: "Album not found" }, { status: 404 });
    }
    return Response.json({ success: true, ...result });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.albums.delete", "Failed to delete album", error, {
      slug,
    });
  }
}

async function handlePATCH(request: Request, context: RouteContext) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const { slug } = await context.params;
  if (!isSafeAlbumSlug(slug))
    return Response.json({ error: "Invalid album slug" }, { status: 400 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const album = await updateAlbumMetadata(slug, body);
    return Response.json({ success: true, album });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update album";
    if (message === "Album not found") return Response.json({ error: message }, { status: 404 });
    if (
      message === "Album title is required" ||
      message === "Enter a valid album date" ||
      message === "Invalid album status" ||
      message === "Add a photo and choose a cover before publishing"
    ) {
      return Response.json({ error: message }, { status: 400 });
    }
    return apiErrorFromRequest(request, "admin.albums.update", "Failed to update album", error, {
      slug,
    });
  }
}

export const Route = createFileRoute("/api/admin/albums/$slug")({
  server: {
    handlers: {
      DELETE: ({ request, params }) => handleDELETE(request, { params: Promise.resolve(params) }),
      PATCH: ({ request, params }) => handlePATCH(request, { params: Promise.resolve(params) }),
    },
  },
});
