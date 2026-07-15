import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { isWordsEnabled } from "@/features/words/reader.server";
import { cleanupShareLinksForSlug, listTrackedShareSlugs } from "@/features/words/share.server";
import { listWords } from "@/features/words/store.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { log } from "@/lib/platform/logger.server";

export const dynamic = "force-dynamic";

async function collectCleanupSlugs(): Promise<string[]> {
  const [trackedSlugs, wordsResult] = await Promise.all([
    listTrackedShareSlugs(),
    listWords({ includeNonPublic: true, limit: 2000 }),
  ]);
  const slugs = new Set<string>(trackedSlugs);
  for (const word of wordsResult.words) {
    slugs.add(word.slug);
  }
  return [...slugs].sort();
}

async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "cron");
  if (authErr) return authErr;

  if (!isWordsEnabled()) {
    return Response.json({ skipped: true, reason: "Words feature is disabled." });
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
    log.info("cron.cleanup-word-shares", "Cron word-share cleanup finished", {
      requestId,
      durationMs,
      scannedSlugs: slugs.length,
      scannedLinks: scanned,
      removedExpired,
      removedRevoked,
      staleIndexRemoved,
      remaining,
    });

    return Response.json({
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
    return apiErrorFromRequest(
      request,
      "cron.cleanup-word-shares",
      "Cron word-share cleanup failed",
      error,
      {
        durationMs: Date.now() - startedAtMs,
      },
    );
  }
}

export const Route = createFileRoute("/api/cron/cleanup-word-shares")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
    },
  },
});
