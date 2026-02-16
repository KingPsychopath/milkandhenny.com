import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { deleteAlbum, isSafeAlbumSlug } from "@/lib/media/admin-albums";
import { apiError } from "@/lib/api-error";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authErr = requireAuth(request, "admin");
  if (authErr) return authErr;

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
    return apiError("admin.albums.delete", "Failed to delete album", error, { slug });
  }
}
