import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { isNotesEnabled } from "@/features/notes/reader";
import { cleanupShareLinksForSlug, listTrackedShareSlugs } from "@/features/notes/share";
import { listNotes } from "@/features/notes/store";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger";

export const dynamic = "force-dynamic";

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

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request, "cron");
  if (authErr) return authErr;

  if (!isNotesEnabled()) {
    return NextResponse.json({ skipped: true, reason: "Notes feature is disabled." });
  }

  const startedAtMs = Date.now();
  const requestId = request.headers.get("x-request-id") ?? null;

  try {
    const slugs = await collectCleanupSlugs();
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

    const durationMs = Date.now() - startedAtMs;
    log.info("cron.cleanup-note-shares", "Cron note-share cleanup finished", {
      requestId,
      durationMs,
      scannedSlugs: slugs.length,
      scannedLinks: scanned,
      removedExpired,
      removedRevoked,
      staleIndexRemoved,
      remaining,
    });

    return NextResponse.json({
      success: true,
      scannedSlugs: slugs.length,
      scannedLinks: scanned,
      removedExpired,
      removedRevoked,
      staleIndexRemoved,
      remaining,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromRequest(request, "cron.cleanup-note-shares", "Cron note-share cleanup failed", error, {
      durationMs: Date.now() - startedAtMs,
    });
  }
}
