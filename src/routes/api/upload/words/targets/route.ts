import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { isWordsEnabled } from "@/features/words/reader.server";
import { listWords } from "@/features/words/store.server";
import { isConfigured, listPrefixes } from "@/lib/platform/r2.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

const R2_TARGETS_TIMEOUT_MS = 1800;
const NOTES_TARGETS_TIMEOUT_MS = 1200;

function extractIdFromPrefix(prefix: string, root: string): string | null {
  if (!prefix.startsWith(root)) return null;
  const rest = prefix.slice(root.length);
  const id = rest.endsWith("/") ? rest.slice(0, -1) : rest;
  if (!id) return null;
  return id;
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * GET /api/upload/words/targets
 *
 * Returns suggested IDs for type-ahead:
 * - slugs: existing words
 * - assets: existing shared asset IDs
 */
async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const slugSet = new Set<string>();
    const assetSet = new Set<string>();

    if (isWordsEnabled()) {
      const noteResult = await withTimeout(
        listWords({ includeNonPublic: true, limit: 500 }),
        NOTES_TARGETS_TIMEOUT_MS,
      );
      if (noteResult) {
        for (const note of noteResult.words) {
          slugSet.add(note.slug);
        }
      }
    }

    if (isConfigured()) {
      const prefixes = await withTimeout(
        Promise.all([listPrefixes("words/media/"), listPrefixes("words/assets/")]),
        R2_TARGETS_TIMEOUT_MS,
      );

      if (prefixes) {
        const [wordPrefixes, assetPrefixes] = prefixes;
        for (const prefix of wordPrefixes) {
          const slug = extractIdFromPrefix(prefix, "words/media/");
          if (slug) slugSet.add(slug);
        }
        for (const prefix of assetPrefixes) {
          const assetId = extractIdFromPrefix(prefix, "words/assets/");
          if (assetId) assetSet.add(assetId);
        }
      }
    }

    return Response.json({
      slugs: [...slugSet].sort(),
      assets: [...assetSet].sort(),
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "upload.words.targets",
      "Failed to load upload targets",
      error,
    );
  }
}

export const Route = createFileRoute("/api/upload/words/targets")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
    },
  },
});
