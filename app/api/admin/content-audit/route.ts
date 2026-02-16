import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { getAllSlugs } from "@/features/blog/reader";
import { isConfigured, listObjects } from "@/lib/platform/r2";
import { validateAllAlbums } from "@/features/media/albums";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

const POSTS_DIR = path.join(process.cwd(), "content/posts");
const R2_PREFIX = "blog/";
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

  if (noFragment.startsWith("blog/")) return noFragment;
  if (noFragment.startsWith("/blog/")) return noFragment.slice(1);

  if (noFragment.startsWith("http://") || noFragment.startsWith("https://")) {
    const marker = "/blog/";
    const idx = noFragment.indexOf(marker);
    if (idx === -1) return null;
    return noFragment.slice(idx + 1);
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
    const postSlugs = getAllSlugs();

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
      for (const slug of postSlugs) {
        const filePath = path.join(POSTS_DIR, `${slug}.md`);
        if (!fs.existsSync(filePath)) continue;
        const raw = fs.readFileSync(filePath, "utf-8");
        checkedRefs += collectBlogRefsWithLines(raw).length;
      }

      blogAudit = {
        r2Configured: false,
        checkedPosts: postSlugs.length,
        checkedRefs,
        brokenRefs: [],
        reason: "R2 not configured in environment, so object existence cannot be verified.",
      };
    } else {
      const r2Keys = await listObjects(R2_PREFIX);
      const r2KeySet = new Set(r2Keys.map((o) => o.key));
      const brokenRefs: BrokenRef[] = [];
      let checkedRefs = 0;

      for (const slug of postSlugs) {
        const filePath = path.join(POSTS_DIR, `${slug}.md`);
        if (!fs.existsSync(filePath)) continue;
        const raw = fs.readFileSync(filePath, "utf-8");
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
        checkedPosts: postSlugs.length,
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
