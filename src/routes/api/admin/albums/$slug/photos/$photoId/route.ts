import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { isSafeAlbumSlug } from "@/features/media/admin-albums";
import { AlbumOperationsService } from "@/features/media/album-operations-service.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
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
    const result = await runMediaEffect(
      Effect.gen(function* () {
        return yield* (yield* AlbumOperationsService).deletePhoto(
          slug,
          decodeURIComponent(photoId),
        );
      }),
      request.signal,
    );
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

async function handlePATCH(request: Request, context: RouteContext) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const { slug, photoId } = await context.params;
  if (!isSafeAlbumSlug(slug))
    return Response.json({ error: "Invalid album slug" }, { status: 400 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const album = await runMediaEffect(
      Effect.gen(function* () {
        return yield* (yield* AlbumOperationsService).updatePhoto(
          slug,
          decodeURIComponent(photoId),
          body,
        );
      }),
      request.signal,
    );
    return Response.json({ success: true, album });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update photo";
    if (message === "Album not found" || message === "Photo not found in album") {
      return Response.json({ error: message }, { status: 404 });
    }
    if (message === "Invalid focal point")
      return Response.json({ error: message }, { status: 400 });
    return apiErrorFromRequest(
      request,
      "admin.albums.photo.update",
      "Failed to update photo",
      error,
      {
        slug,
        photoId,
      },
    );
  }
}

export const Route = createFileRoute("/api/admin/albums/$slug/photos/$photoId")({
  server: {
    handlers: {
      DELETE: ({ request, params }) => handleDELETE(request, { params: Promise.resolve(params) }),
      PATCH: ({ request, params }) => handlePATCH(request, { params: Promise.resolve(params) }),
    },
  },
});
