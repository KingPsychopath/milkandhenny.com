import { NextRequest, NextResponse } from "next/server";
import { requireAdminStepUp, requireAuth } from "@/features/auth/server";
import { isNotesEnabled } from "@/features/notes/reader";
import {
  cleanupShareLinksForSlug,
  deleteAllShareLinksForSlug,
  listTrackedShareSlugs,
} from "@/features/notes/share";
import { listNotes } from "@/features/notes/store";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function collectCleanupSlugs(): Promise<string[]> {
  const [trackedSlugs, notesResult] = await Promise.all([
    listTrackedShareSlugs(),
    listNotes({ includeNonPublic: true, limit: 2000 }),
  ]);
  const slugs = new Set<string>(trackedSlugs);
  for (const note of notesResult.notes) {
    slugs.add(note.slug);
  }
  return [...slugs].sort();
}

export async function POST(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  if (!isNotesEnabled()) {
    return NextResponse.json({ error: "Notes feature is disabled." }, { status: 404 });
  }

  let body: { mode?: "cleanup" | "purge" | "reset" };
  try {
    body = (await request.json()) as { mode?: "cleanup" | "purge" | "reset" };
  } catch {
    body = {};
  }
  const mode = body.mode ?? "cleanup";
  if (!["cleanup", "purge", "reset"].includes(mode)) {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  try {
    const slugs = await collectCleanupSlugs();
    if (mode === "purge" || mode === "reset") {
      let deletedLinks = 0;
      for (const slug of slugs) {
        deletedLinks += await deleteAllShareLinksForSlug(slug);
      }
      return NextResponse.json({
        ok: true,
        mode,
        scannedSlugs: slugs.length,
        deletedLinks,
        remaining: 0,
        cleanedAt: new Date().toISOString(),
      });
    }

    let scanned = 0;
    let removedExpired = 0;
    let removedRevoked = 0;
    let staleIndexRemoved = 0;
    let remaining = 0;
    for (const slug of slugs) {
      const result = await cleanupShareLinksForSlug(slug);
      scanned += result.scanned;
      removedExpired += result.removedExpired;
      removedRevoked += result.removedRevoked;
      staleIndexRemoved += result.staleIndexRemoved;
      remaining += result.remaining;
    }

    return NextResponse.json({
      ok: true,
      mode,
      scannedSlugs: slugs.length,
      scannedLinks: scanned,
      removedExpired,
      removedRevoked,
      staleIndexRemoved,
      remaining,
      cleanedAt: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.word-shares.cleanup", "Failed to cleanup share links", error);
  }
}
