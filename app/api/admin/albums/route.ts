import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listAdminAlbums } from "@/lib/media/admin-albums";
import { apiErrorFromRequest } from "@/lib/api-error";

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const albums = listAdminAlbums();
    return NextResponse.json({ albums });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.albums.list", "Failed to load albums", error);
  }
}
