import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { isConfigured, listObjects } from "@/lib/platform/r2";
import { validateAllAlbums } from "@/features/media/albums";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { isNotesEnabled } from "@/features/notes/reader";
import { getNote, listNotes } from "@/features/notes/store";

const WORDS_MEDIA_PREFIX = "words/media/";
const WORDS_ASSETS_PREFIX = "words/assets/";
const LEGACY_BLOG_PREFIX = "blog/";
const LINK_RE = /!?\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

type BrokenRef = {
  postSlug: string;
  line: number;
  ref: string;
  key: string;
};

function normalizeBlogRefToKey(rawRef: string): string | null {
  const ref = rawRef.trim().replace(/^<|>$/g, "");
  if (!ref) return null;

  const noFragment = ref.split("#")[0].split("?")[0];
  if (!noFragment) return null;

  if (noFragment.startsWith("words/media/")) return noFragment;
  if (noFragment.startsWith("/words/media/")) return noFragment.slice(1);
  if (noFragment.startsWith("words/assets/")) return noFragment;
  if (noFragment.startsWith("/words/assets/")) return noFragment.slice(1);
  if (noFragment.startsWith("blog/")) return noFragment;
  if (noFragment.startsWith("/blog/")) return noFragment.slice(1);

  if (noFragment.startsWith("http://") || noFragment.startsWith("https://")) {
    for (const marker of ["/words/media/", "/words/assets/", "/blog/"]) {
      const idx = noFragment.indexOf(marker);
      if (idx !== -1) return noFragment.slice(idx + 1);
    }
    return null;
  }

  return null;
}

function collectBlogRefsWithLines(content: string): Array<{ ref: string; line: number }> {
  const out: Array<{ ref: string; line: number }> = [];
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    LINK_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LINK_RE.exec(line)) !== null) {
      const ref = match[1];
      if (typeof ref === "string" && ref.trim()) {
        out.push({ ref: ref.trim(), line: i + 1 });
      }
    }
  });
  return out;
}

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const albumValidation = validateAllAlbums();
    const wordSlugs = isNotesEnabled()
      ? (await listNotes({ includeNonPublic: true, type: "blog", limit: 2000 })).notes.map((n) => n.slug)
      : [];

    let blogAudit:
      | {
          r2Configured: false;
          checkedPosts: number;
          checkedRefs: number;
          brokenRefs: BrokenRef[];
          reason: string;
        }
      | {
          r2Configured: true;
          checkedPosts: number;
          checkedRefs: number;
          brokenRefs: BrokenRef[];
        };

    if (!isConfigured()) {
      let checkedRefs = 0;
      for (const slug of wordSlugs) {
        const note = await getNote(slug);
        if (!note) continue;
        const raw = note.markdown;
        checkedRefs += collectBlogRefsWithLines(raw).length;
      }

      blogAudit = {
        r2Configured: false,
        checkedPosts: wordSlugs.length,
        checkedRefs,
        brokenRefs: [],
        reason: "R2 not configured in environment, so object existence cannot be verified.",
      };
    } else {
      const [newMediaKeys, newAssetKeys, legacyKeys] = await Promise.all([
        listObjects(WORDS_MEDIA_PREFIX),
        listObjects(WORDS_ASSETS_PREFIX),
        listObjects(LEGACY_BLOG_PREFIX),
      ]);
      const r2KeySet = new Set([...newMediaKeys, ...newAssetKeys, ...legacyKeys].map((o) => o.key));
      const brokenRefs: BrokenRef[] = [];
      let checkedRefs = 0;

      for (const slug of wordSlugs) {
        const note = await getNote(slug);
        if (!note) continue;
        const raw = note.markdown;
        const refs = collectBlogRefsWithLines(raw);

        refs.forEach(({ ref, line }) => {
          const key = normalizeBlogRefToKey(ref);
          if (!key) return;
          checkedRefs++;
          if (!r2KeySet.has(key)) {
            brokenRefs.push({
              postSlug: slug,
              line,
              ref,
              key,
            });
          }
        });
      }

      blogAudit = {
        r2Configured: true,
        checkedPosts: wordSlugs.length,
        checkedRefs,
        brokenRefs,
      };
    }

    return NextResponse.json({
      albumValidation: {
        invalidCount: albumValidation.length,
        invalidAlbums: albumValidation,
      },
      blogAudit,
      auditedAt: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.content-audit", "Failed to run content audit", error);
  }
}
