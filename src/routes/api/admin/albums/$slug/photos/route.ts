import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { isSafeAlbumSlug } from "@/features/media/admin-albums";
import { AlbumOperationsService } from "@/features/media/album-operations-service.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
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
    const result = await runMediaEffect(
      Effect.gen(function* () {
        return yield* (yield* AlbumOperationsService).deletePhotos(slug, body.photoIds as string[]);
      }),
      request.signal,
    );
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
