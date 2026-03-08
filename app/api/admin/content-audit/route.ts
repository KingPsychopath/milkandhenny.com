import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { isConfigured, listObjects } from "@/lib/platform/r2";
import { validateAllAlbums } from "@/features/media/albums";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { isWordsEnabled } from "@/features/words/reader";
import { getWord, listWords } from "@/features/words/store";
import { getRedis } from "@/lib/platform/redis";

const WORDS_MEDIA_PREFIX = "words/media/";
const WORDS_ASSETS_PREFIX = "words/assets/";
const LINK_RE = /!?\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const CONTENT_AUDIT_CACHE_KEY = "admin:content-audit:v1";
const CONTENT_AUDIT_CACHE_TTL_SECONDS = 15 * 60;

let memoryContentAuditCache:
  | { expiresAt: number; value: Record<string, unknown> }
  | null = null;

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

  if (noFragment.startsWith("http://") || noFragment.startsWith("https://")) {
    for (const marker of ["/words/media/", "/words/assets/"]) {
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
    const refresh = request.nextUrl.searchParams.get("refresh") === "1";
    if (!refresh) {
      const cached = await readCachedContentAudit();
      if (cached) {
        return NextResponse.json({ ...cached, cached: true });
      }
    }

    const computed = await computeContentAudit();
    await writeCachedContentAudit(computed);

    return NextResponse.json({ ...computed, cached: false });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.content-audit", "Failed to run content audit", error);
  }
}

async function computeContentAudit(): Promise<Record<string, unknown>> {
  const albumValidation = validateAllAlbums();
  const wordSlugs = isWordsEnabled()
    ? (await listWords({ includeNonPublic: true, type: "blog", limit: 2000 })).words.map((n) => n.slug)
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
      const note = await getWord(slug);
      if (!note) continue;
      checkedRefs += collectBlogRefsWithLines(note.markdown).length;
    }

    blogAudit = {
      r2Configured: false,
      checkedPosts: wordSlugs.length,
      checkedRefs,
      brokenRefs: [],
      reason: "R2 not configured in environment, so object existence cannot be verified.",
    };
  } else {
    const [newMediaKeys, newAssetKeys] = await Promise.all([
      listObjects(WORDS_MEDIA_PREFIX),
      listObjects(WORDS_ASSETS_PREFIX),
    ]);
    const r2KeySet = new Set([...newMediaKeys, ...newAssetKeys].map((o) => o.key));
    const brokenRefs: BrokenRef[] = [];
    let checkedRefs = 0;

    for (const slug of wordSlugs) {
      const note = await getWord(slug);
      if (!note) continue;
      const refs = collectBlogRefsWithLines(note.markdown);

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

  return {
    albumValidation: {
      invalidCount: albumValidation.length,
      invalidAlbums: albumValidation,
    },
    blogAudit,
    auditedAt: new Date().toISOString(),
  };
}

async function readCachedContentAudit(): Promise<Record<string, unknown> | null> {
  const redis = getRedis();
  if (redis) {
    const raw = await redis.get<Record<string, unknown> | string>(CONTENT_AUDIT_CACHE_KEY);
    if (!raw) return null;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return raw as Record<string, unknown>;
  }

  if (!memoryContentAuditCache || memoryContentAuditCache.expiresAt <= Date.now()) {
    memoryContentAuditCache = null;
    return null;
  }
  return memoryContentAuditCache.value;
}

async function writeCachedContentAudit(value: Record<string, unknown>): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.set(CONTENT_AUDIT_CACHE_KEY, JSON.stringify(value), {
      ex: CONTENT_AUDIT_CACHE_TTL_SECONDS,
    });
    return;
  }

  memoryContentAuditCache = {
    value,
    expiresAt: Date.now() + CONTENT_AUDIT_CACHE_TTL_SECONDS * 1000,
  };
}
