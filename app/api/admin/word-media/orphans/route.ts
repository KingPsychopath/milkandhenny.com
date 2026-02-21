import { NextRequest, NextResponse } from "next/server";
import { requireAdminStepUp, requireAuth } from "@/features/auth/server";
import {
  cleanupOrphanWordMediaFolders,
  scanOrphanWordMediaFolders,
} from "@/features/words/media-maintenance";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;

  try {
    const summary = await scanOrphanWordMediaFolders({ limit });
    return NextResponse.json(summary);
  } catch (error) {
    return apiErrorFromRequest(request, "admin.word-media.orphans.scan", "Failed to scan orphan word media folders", error);
  }
}

export async function POST(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  try {
    const result = await cleanupOrphanWordMediaFolders();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.word-media.orphans.cleanup", "Failed to cleanup orphan word media folders", error);
  }
}

