import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import {
  finalizeAlbumUploads,
  isSafeAlbumSlug,
  type PreparedAlbumUpload,
} from "@/features/media/admin-albums";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

export const maxDuration = 120;

async function handlePOST(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  if (!isSafeAlbumSlug(slug))
    return Response.json({ error: "Invalid album slug" }, { status: 400 });
  try {
    const body = (await request.json()) as { files?: PreparedAlbumUpload[] };
    if (!Array.isArray(body.files) || body.files.length === 0) {
      return Response.json({ error: "No uploaded files were supplied" }, { status: 400 });
    }
    const result = await finalizeAlbumUploads(slug, body.files);
    return Response.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process uploads";
    if (message === "Album not found") return Response.json({ error: message }, { status: 404 });
    if (
      message === "Invalid album upload key" ||
      message === "Invalid photo id" ||
      message === "Invalid uploaded image" ||
      message === "Uploaded album image failed verification" ||
      message.startsWith("Choose between") ||
      message.startsWith("An album can contain") ||
      message.startsWith("Photo ID already exists") ||
      message === "A photo with the same ID was added during processing"
    ) {
      return Response.json({ error: message }, { status: 400 });
    }
    return apiErrorFromRequest(
      request,
      "admin.albums.upload.finalize",
      "Failed to process uploads",
      error,
      {
        slug,
      },
    );
  }
}

export const Route = createFileRoute("/api/admin/albums/$slug/upload/finalize")({
  server: { handlers: { POST: ({ request, params }) => handlePOST(request, params.slug) } },
});
