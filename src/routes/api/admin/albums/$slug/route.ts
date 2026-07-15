import { createFileRoute } from "@tanstack/react-router";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { deleteAlbum, isSafeAlbumSlug } from "@/features/media/admin-albums";
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
    if (!result.deletedJson) {
      return Response.json({ error: "Album not found" }, { status: 404 });
    }
    return Response.json({ success: true, ...result });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.albums.delete", "Failed to delete album", error, {
      slug,
    });
  }
}

export const Route = createFileRoute("/api/admin/albums/$slug")({
  server: {
    handlers: {
      DELETE: ({ request, params }) => handleDELETE(request, { params: Promise.resolve(params) }),
    },
  },
});
