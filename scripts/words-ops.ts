import "server-only";

import { BASE_URL } from "@/lib/shared/config";
import { getRedis } from "@/lib/platform/redis";
import { WORD_INDEX_KEY, wordMetaKey, wordShareIndexKey, wordShareKey, wordShareSlugsKey } from "@/features/words/config";
import {
  cleanupShareLinksForSlug,
  createShareLink,
  deleteAllShareLinksForSlug,
  listShareLinks,
  listTrackedShareSlugs,
  revokeShareLink,
  updateShareLink,
} from "@/features/words/share";
import { createWord, deleteWord, getWord, listWords, updateWord } from "@/features/words/store";
import type { NoteVisibility, ShareLink } from "@/features/words/content-types";
import type { WordType } from "@/features/words/types";

const LEGACY_WORD_INDEX_KEY = "notes:index";
const LEGACY_WORD_META_PREFIX = "notes:meta:";
const LEGACY_WORD_SHARE_PREFIX = "notes:share:";
const LEGACY_WORD_SHARE_INDEX_PREFIX = "notes:share-index:";
const LEGACY_WORD_SHARE_SLUGS_KEY = "notes:share-slugs";

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
  opts?: { expiresInDays?: number; pinRequired?: boolean; pin?: string }
) {
  const created = await createShareLink({
    slug,
    expiresInDays: opts?.expiresInDays,
    pinRequired: opts?.pinRequired,
    pin: opts?.pin,
  });

  return {
    ...created,
    url: `${BASE_URL}/words/${slug}?share=${encodeURIComponent(created.token)}`,
  };
}

async function listWordShares(slug: string) {
  return listShareLinks(slug);
}

async function updateWordShare(
  slug: string,
  id: string,
  opts: { pinRequired?: boolean; pin?: string | null; expiresInDays?: number; rotateToken?: boolean }
) {
  const updated = await updateShareLink(slug, id, opts);
  if (!updated) return null;
  return {
    ...updated,
    url: updated.token
      ? `${BASE_URL}/words/${slug}?share=${encodeURIComponent(updated.token)}`
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

type LegacyMigrationResult = {
  indexSlugsFound: number;
  metaRecordsMigrated: number;
  shareRecordsMigrated: number;
  shareIndexSetsMigrated: number;
  shareIndexMembersMigrated: number;
  shareSlugsMigrated: number;
  legacyKeysPurged: number;
};

function legacyWordMetaKey(slug: string): string {
  return `${LEGACY_WORD_META_PREFIX}${slug}`;
}

function legacyWordShareIndexKey(slug: string): string {
  return `${LEGACY_WORD_SHARE_INDEX_PREFIX}${slug}`;
}

function parseLegacyShareId(key: string): string | null {
  if (!key.startsWith(LEGACY_WORD_SHARE_PREFIX)) return null;
  const id = key.slice(LEGACY_WORD_SHARE_PREFIX.length);
  if (!id || id.includes(":")) return null;
  return id;
}

async function migrateLegacyWordsNamespace(opts?: { purgeLegacy?: boolean }): Promise<LegacyMigrationResult> {
  const redis = getRedis();
  if (!redis) {
    throw new Error("Redis/KV is not configured.");
  }

  const purgeLegacy = !!opts?.purgeLegacy;
  const legacySlugsRaw = await redis.smembers(LEGACY_WORD_INDEX_KEY);
  const legacySlugs = (Array.isArray(legacySlugsRaw) ? legacySlugsRaw : [])
    .filter((slug): slug is string => typeof slug === "string" && !!slug);

  let metaRecordsMigrated = 0;
  let shareRecordsMigrated = 0;
  let shareIndexSetsMigrated = 0;
  let shareIndexMembersMigrated = 0;
  let shareSlugsMigrated = 0;
  let legacyKeysPurged = 0;

  for (const slug of legacySlugs) {
    const legacyMeta = await redis.get(legacyWordMetaKey(slug));
    if (!legacyMeta) continue;
    await Promise.all([
      redis.set(wordMetaKey(slug), legacyMeta as object),
      redis.sadd(WORD_INDEX_KEY, slug),
    ]);
    metaRecordsMigrated += 1;
    if (purgeLegacy) {
      await Promise.all([
        redis.del(legacyWordMetaKey(slug)),
        redis.srem(LEGACY_WORD_INDEX_KEY, slug),
      ]);
      legacyKeysPurged += 1;
    }
  }

  const legacyShareKeysRaw = await redis.keys(`${LEGACY_WORD_SHARE_PREFIX}*`);
  const legacyShareKeys = (Array.isArray(legacyShareKeysRaw) ? legacyShareKeysRaw : [])
    .filter((key): key is string => typeof key === "string");

  for (const key of legacyShareKeys) {
    const shareId = parseLegacyShareId(key);
    if (!shareId) continue;
    const raw = await redis.get<ShareLink | string>(key);
    if (!raw) continue;
    const link = typeof raw === "string" ? (JSON.parse(raw) as ShareLink) : raw;
    if (!link?.slug) continue;

    await Promise.all([
      redis.set(wordShareKey(shareId), raw as object),
      redis.sadd(wordShareIndexKey(link.slug), shareId),
      redis.sadd(wordShareSlugsKey(), link.slug),
    ]);

    const ttl = await redis.ttl(key);
    if (typeof ttl === "number" && ttl > 0) {
      await redis.expire(wordShareKey(shareId), ttl);
    }

    shareRecordsMigrated += 1;
    if (purgeLegacy) {
      await redis.del(key);
      legacyKeysPurged += 1;
    }
  }

  const legacyShareIndexKeysRaw = await redis.keys(`${LEGACY_WORD_SHARE_INDEX_PREFIX}*`);
  const legacyShareIndexKeys = (Array.isArray(legacyShareIndexKeysRaw) ? legacyShareIndexKeysRaw : [])
    .filter((key): key is string => typeof key === "string");

  for (const key of legacyShareIndexKeys) {
    const slug = key.slice(LEGACY_WORD_SHARE_INDEX_PREFIX.length);
    if (!slug) continue;
    const idsRaw = await redis.smembers(key);
    const ids = (Array.isArray(idsRaw) ? idsRaw : [])
      .filter((id): id is string => typeof id === "string" && !!id);
    if (ids.length > 0) {
      for (const id of ids) {
        await redis.sadd(wordShareIndexKey(slug), id);
      }
      await redis.sadd(wordShareSlugsKey(), slug);
      shareIndexMembersMigrated += ids.length;
    }
    shareIndexSetsMigrated += 1;
    if (purgeLegacy) {
      await redis.del(key);
      legacyKeysPurged += 1;
    }
  }

  const legacyShareSlugsRaw = await redis.smembers(LEGACY_WORD_SHARE_SLUGS_KEY);
  const legacyShareSlugs = (Array.isArray(legacyShareSlugsRaw) ? legacyShareSlugsRaw : [])
    .filter((slug): slug is string => typeof slug === "string" && !!slug);
  if (legacyShareSlugs.length > 0) {
    for (const slug of legacyShareSlugs) {
      await redis.sadd(wordShareSlugsKey(), slug);
    }
    shareSlugsMigrated = legacyShareSlugs.length;
  }
  if (purgeLegacy) {
    await redis.del(LEGACY_WORD_SHARE_SLUGS_KEY);
    legacyKeysPurged += 1;
  }

  return {
    indexSlugsFound: legacySlugs.length,
    metaRecordsMigrated,
    shareRecordsMigrated,
    shareIndexSetsMigrated,
    shareIndexMembersMigrated,
    shareSlugsMigrated,
    legacyKeysPurged,
  };
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
  migrateLegacyWordsNamespace,
};
