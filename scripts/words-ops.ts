import { BASE_URL } from "@/lib/shared/config";
import { buildWordShareUrl } from "@/features/words/routes";
import {
  cleanupShareLinksForSlug,
  createShareLink,
  deleteAllShareLinksForSlug,
  listShareLinks,
  listTrackedShareSlugs,
  revokeShareLink,
  updateShareLink,
} from "@/features/words/share.server";
import {
  createWord,
  deleteWord,
  getWord,
  getWordMeta,
  listWords,
  updateWord,
} from "@/features/words/store.server";
import type { NoteVisibility } from "@/features/words/content-types";
import type { WordType } from "@/features/words/types";

type CreateWordInput = {
  slug: string;
  title: string;
  subtitle?: string;
  image?: string;
  type?: WordType;
  visibility?: NoteVisibility;
  markdown: string;
  tags?: string[];
  featured?: boolean;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
  bodyKey?: string;
};

type UpdateWordInput = {
  title?: string;
  subtitle?: string | null;
  image?: string | null;
  type?: WordType;
  visibility?: NoteVisibility;
  markdown?: string;
  tags?: string[];
  featured?: boolean;
};

async function createWordRecord(input: CreateWordInput) {
  return createWord(input);
}

async function listWordRecords(options?: {
  visibility?: NoteVisibility;
  type?: WordType;
  tag?: string;
  q?: string;
  limit?: number;
  includeNonPublic?: boolean;
}) {
  const result = await listWords({
    visibility: options?.visibility,
    type: options?.type,
    tag: options?.tag,
    q: options?.q,
    limit: options?.limit ?? 100,
    includeNonPublic: options?.includeNonPublic ?? true,
  });
  return { words: result.words, nextCursor: result.nextCursor };
}

async function getWordRecord(slug: string) {
  return getWord(slug);
}

async function updateWordRecord(slug: string, input: UpdateWordInput) {
  return updateWord(slug, input);
}

async function deleteWordRecord(slug: string) {
  return deleteWord(slug);
}

async function createWordShare(
  slug: string,
  opts?: { expiresInDays?: number; pinRequired?: boolean; pin?: string },
) {
  const meta = await getWordMeta(slug);
  const created = await createShareLink({
    slug,
    expiresInDays: opts?.expiresInDays,
    pinRequired: opts?.pinRequired,
    pin: opts?.pin,
  });

  return {
    ...created,
    url: buildWordShareUrl(BASE_URL, slug, created.token, meta?.visibility ?? "private"),
  };
}

async function listWordShares(slug: string) {
  return listShareLinks(slug);
}

async function updateWordShare(
  slug: string,
  id: string,
  opts: {
    pinRequired?: boolean;
    pin?: string | null;
    expiresInDays?: number;
    rotateToken?: boolean;
  },
) {
  const meta = await getWordMeta(slug);
  const updated = await updateShareLink(slug, id, opts);
  if (!updated) return null;
  return {
    ...updated,
    url: updated.token
      ? buildWordShareUrl(BASE_URL, slug, updated.token, meta?.visibility ?? "private")
      : undefined,
  };
}

async function revokeWordShare(slug: string, id: string) {
  return revokeShareLink(slug, id);
}

async function collectShareSlugs(slug?: string): Promise<string[]> {
  if (slug) return [slug];
  const [tracked, notesResult] = await Promise.all([
    listTrackedShareSlugs(),
    listWords({ includeNonPublic: true, limit: 2000 }),
  ]);
  const slugs = new Set<string>(tracked);
  for (const note of notesResult.words) {
    slugs.add(note.slug);
  }
  return [...slugs].sort();
}

async function cleanupWordShares(slug?: string) {
  const slugs = await collectShareSlugs(slug);
  let scannedLinks = 0;
  let removedExpired = 0;
  let removedRevoked = 0;
  let staleIndexRemoved = 0;
  let remaining = 0;

  for (const item of slugs) {
    const result = await cleanupShareLinksForSlug(item);
    scannedLinks += result.scanned;
    removedExpired += result.removedExpired;
    removedRevoked += result.removedRevoked;
    staleIndexRemoved += result.staleIndexRemoved;
    remaining += result.remaining;
  }

  return {
    scannedSlugs: slugs.length,
    scannedLinks,
    removedExpired,
    removedRevoked,
    staleIndexRemoved,
    remaining,
  };
}

async function purgeWordShares(slug?: string) {
  const slugs = await collectShareSlugs(slug);
  let deletedLinks = 0;
  for (const item of slugs) {
    deletedLinks += await deleteAllShareLinksForSlug(item);
  }
  return {
    scannedSlugs: slugs.length,
    deletedLinks,
    remaining: 0,
  };
}

async function resetWordShares() {
  return purgeWordShares();
}

export {
  createWordRecord,
  listWordRecords,
  getWordRecord,
  updateWordRecord,
  deleteWordRecord,
  createWordShare,
  listWordShares,
  updateWordShare,
  revokeWordShare,
  cleanupWordShares,
  purgeWordShares,
  resetWordShares,
};
