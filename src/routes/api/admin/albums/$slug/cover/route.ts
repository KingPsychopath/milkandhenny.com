import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { isSafeAlbumSlug, setAlbumCover } from "@/features/media/admin-albums";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

async function handlePATCH(request: Request, context: RouteContext) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const { slug } = await context.params;
  if (!isSafeAlbumSlug(slug)) {
    return Response.json({ error: "Invalid album slug" }, { status: 400 });
  }

  let body: { photoId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.photoId || typeof body.photoId !== "string") {
    return Response.json({ error: "photoId is required" }, { status: 400 });
  }

  try {
    const album = setAlbumCover(slug, body.photoId.trim());
    return Response.json({ success: true, album });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to set album cover";
    if (
      msg === "Invalid album slug" ||
      msg === "Invalid photo id" ||
      msg === "Photo not found in album" ||
      msg ===
        "Album manifests are read-only in this runtime. Use the CLI and commit changes to git."
    ) {
      return Response.json({ error: msg }, { status: 400 });
    }
    if (msg === "Album not found") {
      return Response.json({ error: msg }, { status: 404 });
    }
    return apiErrorFromRequest(request, "admin.albums.cover", "Failed to set album cover", error, {
      slug,
    });
  }
}

export const Route = createFileRoute("/api/admin/albums/$slug/cover")({
  server: {
    handlers: {
      PATCH: ({ request, params }) => handlePATCH(request, { params: Promise.resolve(params) }),
    },
  },
});
