import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listAdminAlbums } from "@/lib/media/admin-albums";
import { apiError } from "@/lib/api-error";

export async function GET(request: NextRequest) {
  const authErr = requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const albums = listAdminAlbums();
    return NextResponse.json({ albums });
  } catch (error) {
    return apiError("admin.albums.list", "Failed to load albums", error);
  }
}
