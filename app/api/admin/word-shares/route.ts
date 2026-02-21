import { NextRequest, NextResponse } from "next/server";
import { requireAdminStepUp, requireAuth } from "@/features/auth/server";
import { isWordsEnabled } from "@/features/words/reader";
import { listShareLinks, revokeShareLink } from "@/features/words/share";
import { listWords } from "@/features/words/store";
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
  const { words } = await listWords({
    includeNonPublic: true,
    limit: 2000,
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
    })
  );

  return summaries
    .filter((item): item is SharedWordSummary => !!item)
    .sort((a, b) => new Date(a.nextExpiryAt).getTime() - new Date(b.nextExpiryAt).getTime());
}

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  if (!isWordsEnabled()) {
    return NextResponse.json({ items: [] });
  }

  try {
    const items = await buildSharedWordSummaries();
    return NextResponse.json({ items });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.word-shares.list", "Failed to load shared pages", error);
  }
}

export async function POST(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  if (!isWordsEnabled()) {
    return NextResponse.json({ error: "Words feature is disabled." }, { status: 404 });
  }

  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  let body: { slug?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const slug = (body.slug ?? "").trim().toLowerCase();
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  try {
    const links = await listShareLinks(slug);
    const active = links.filter(isLinkActive);
    let revoked = 0;
    for (const link of active) {
      const ok = await revokeShareLink(slug, link.id);
      if (ok) revoked += 1;
    }
    return NextResponse.json({ ok: true, slug, revoked });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.word-shares.revoke", "Failed to revoke shared links", error, { slug });
  }
}
