import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { isWordsEnabled } from "@/features/words/reader.server";
import { listShareLinks } from "@/features/words/share.server";
import { listAllWords } from "@/features/words/store.server";
import { MediaMaintenanceService } from "@/features/system/media-maintenance-service.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import type { WordType } from "@/features/words/types";
import type { WordVisibility } from "@/features/words/content-types";

type SharedWordSummary = {
  slug: string;
  title: string;
  type: WordType;
  visibility: WordVisibility;
  activeShareCount: number;
  pinProtectedCount: number;
  nextExpiryAt: string;
};

function isLinkActive(link: { revokedAt?: string; expiresAt: string }): boolean {
  if (link.revokedAt) return false;
  return new Date(link.expiresAt).getTime() > Date.now();
}

async function buildSharedWordSummaries(): Promise<SharedWordSummary[]> {
  const words = await listAllWords({
    includeNonPublic: true,
  });

  const summaries = await Promise.all(
    words.map(async (note) => {
      const links = await listShareLinks(note.slug);
      const active = links.filter(isLinkActive);
      if (active.length === 0) return null;

      let nextExpiryAt = active[0]?.expiresAt ?? note.updatedAt;
      for (const link of active) {
        if (new Date(link.expiresAt).getTime() < new Date(nextExpiryAt).getTime()) {
          nextExpiryAt = link.expiresAt;
        }
      }

      return {
        slug: note.slug,
        title: note.title,
        type: note.type,
        visibility: note.visibility,
        activeShareCount: active.length,
        pinProtectedCount: active.filter((link) => link.pinRequired).length,
        nextExpiryAt,
      } satisfies SharedWordSummary;
    }),
  );

  return summaries
    .filter((item): item is SharedWordSummary => !!item)
    .sort((a, b) => new Date(a.nextExpiryAt).getTime() - new Date(b.nextExpiryAt).getTime());
}

async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  if (!isWordsEnabled()) {
    return Response.json({ items: [] });
  }

  try {
    const items = await buildSharedWordSummaries();
    return Response.json({ items });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.word-shares.list",
      "Failed to load shared pages",
      error,
    );
  }
}

async function handlePOST(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  if (!isWordsEnabled()) {
    return Response.json({ error: "Words feature is disabled." }, { status: 404 });
  }

  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  let body: { slug?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const slug = (body.slug ?? "").trim().toLowerCase();
  if (!slug) {
    return Response.json({ error: "slug is required" }, { status: 400 });
  }

  try {
    const revoked = await runMediaEffect(
      Effect.gen(function* () {
        return yield* (yield* MediaMaintenanceService).revokeWordShares(slug);
      }),
      request.signal,
    );
    return Response.json({ ok: true, slug, revoked });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.word-shares.revoke",
      "Failed to revoke shared links",
      error,
      { slug },
    );
  }
}

export const Route = createFileRoute("/api/admin/word-shares")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      POST: ({ request }) => handlePOST(request),
    },
  },
});
