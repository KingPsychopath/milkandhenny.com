import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isSafeAlbumSlug, setAlbumCover } from "@/lib/media/admin-albums";
import { apiError } from "@/lib/api-error";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const authErr = requireAuth(request, "admin");
  if (authErr) return authErr;

  const { slug } = await context.params;
  if (!isSafeAlbumSlug(slug)) {
    return NextResponse.json({ error: "Invalid album slug" }, { status: 400 });
  }

  let body: { photoId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.photoId || typeof body.photoId !== "string") {
    return NextResponse.json({ error: "photoId is required" }, { status: 400 });
  }

  try {
    const album = setAlbumCover(slug, body.photoId.trim());
    return NextResponse.json({ success: true, album });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to set album cover";
    if (
      msg === "Invalid album slug" ||
      msg === "Invalid photo id" ||
      msg === "Photo not found in album" ||
      msg === "Album manifests are read-only in this runtime. Use the CLI and commit changes to git."
    ) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (msg === "Album not found") {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    return apiError("admin.albums.cover", "Failed to set album cover", error, { slug });
  }
}
