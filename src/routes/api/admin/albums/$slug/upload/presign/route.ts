import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { requireAuth } from "@/features/auth/auth.server";
import { isSafeAlbumSlug, type AlbumUploadInput } from "@/features/media/admin-albums";
import { AlbumOperationsService } from "@/features/media/album-operations-service.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handlePOST(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  if (!isSafeAlbumSlug(slug))
    return Response.json({ error: "Invalid album slug" }, { status: 400 });
  try {
    const body = (await request.json()) as { files?: AlbumUploadInput[] };
    const uploads = await runMediaEffect(
      Effect.gen(function* () {
        return yield* (yield* AlbumOperationsService).prepareUploads(
          slug,
          Array.isArray(body.files) ? body.files : [],
        );
      }),
      request.signal,
    );
    return Response.json({ success: true, uploads });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to prepare uploads";
    if (
      message === "Album not found" ||
      message.startsWith("Choose between") ||
      message.startsWith("An album can contain") ||
      message.includes("larger than") ||
      message.includes("not a supported image") ||
      message.includes("needs a file name")
    ) {
      return Response.json(
        { error: message },
        { status: message === "Album not found" ? 404 : 400 },
      );
    }
    return apiErrorFromRequest(
      request,
      "admin.albums.upload.presign",
      "Failed to prepare uploads",
      error,
      {
        slug,
      },
    );
  }
}

export const Route = createFileRoute("/api/admin/albums/$slug/upload/presign")({
  server: { handlers: { POST: ({ request, params }) => handlePOST(request, params.slug) } },
});
