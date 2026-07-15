import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { listAdminAlbums } from "@/features/media/admin-albums";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const albums = listAdminAlbums();
    return Response.json({ albums });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.albums.list", "Failed to load albums", error);
  }
}

export const Route = createFileRoute("/api/admin/albums")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
    },
  },
});
