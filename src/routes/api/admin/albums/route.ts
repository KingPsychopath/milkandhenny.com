import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { createAdminAlbum, listAdminAlbums } from "@/features/media/admin-albums";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const albums = await listAdminAlbums();
    return Response.json({ albums });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.albums.list", "Failed to load albums", error);
  }
}

async function handlePOST(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const album = await createAdminAlbum(body);
    return Response.json({ success: true, album }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create album";
    if (
      message === "Enter a valid album slug" ||
      message === "Album title is required" ||
      message === "Album date is required" ||
      message === "An album with this slug already exists"
    ) {
      return Response.json({ error: message }, { status: 400 });
    }
    return apiErrorFromRequest(request, "admin.albums.create", "Failed to create album", error);
  }
}

export const Route = createFileRoute("/api/admin/albums")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      POST: ({ request }) => handlePOST(request),
    },
  },
});
