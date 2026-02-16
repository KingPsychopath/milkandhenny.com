import { NextRequest, NextResponse } from "next/server";
import { requireAdminStepUp, requireAuth } from "@/lib/auth";
import { deleteAlbumPhoto, isSafeAlbumSlug } from "@/lib/media/admin-albums";
import { apiError } from "@/lib/api-error";

type RouteContext = {
  params: Promise<{ slug: string; photoId: string }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  const { slug, photoId } = await context.params;
  if (!isSafeAlbumSlug(slug)) {
    return NextResponse.json({ error: "Invalid album slug" }, { status: 400 });
  }
  if (!photoId || typeof photoId !== "string") {
    return NextResponse.json({ error: "Invalid photo id" }, { status: 400 });
  }

  try {
    const result = await deleteAlbumPhoto(slug, decodeURIComponent(photoId));
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to delete photo";
    if (
      msg === "Album not found" ||
      msg === "Photo not found in album"
    ) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (
      msg === "Invalid album slug" ||
      msg === "Invalid photo id" ||
      msg === "Cannot delete the last photo. Delete the album instead."
    ) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return apiError("admin.albums.photo.delete", "Failed to delete photo", error, {
      slug,
      photoId,
    });
  }
}
