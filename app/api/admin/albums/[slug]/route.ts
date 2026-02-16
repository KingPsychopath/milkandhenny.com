import { NextRequest, NextResponse } from "next/server";
import { requireAdminStepUp, requireAuth } from "@/lib/auth";
import { deleteAlbum, isSafeAlbumSlug } from "@/lib/media/admin-albums";
import { apiErrorFromRequest } from "@/lib/api-error";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  const { slug } = await context.params;
  if (!isSafeAlbumSlug(slug)) {
    return NextResponse.json({ error: "Invalid album slug" }, { status: 400 });
  }

  try {
    const result = await deleteAlbum(slug);
    if (!result.deletedJson) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.albums.delete", "Failed to delete album", error, {
      slug,
    });
  }
}
