import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { listAdminAlbums } from "@/features/media/admin-albums";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

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
