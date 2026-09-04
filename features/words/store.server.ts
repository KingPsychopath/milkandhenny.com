import {
  copyObject,
  deleteObject,
  deleteObjects,
  downloadBuffer,
  isConfigured,
  listObjects,
  uploadBuffer,
} from "@/lib/platform/object-storage-provider-context.server";
import type { StorageScope } from "@/lib/platform/r2.server";
import { randomUUID } from "node:crypto";
import { getRedis } from "@/lib/platform/redis.server";
import { WORD_INDEX_KEY, wordContentKey, wordMetaKey } from "./config.server";
import { deleteAllShareLinksForSlug } from "./share.server";
import {
  isWordVisibility,
  type NoteMeta,
  type NoteRecord,
  type WordVisibility,
} from "./content-types";
import type { WordType } from "@/features/words/types";
import { isWordType, normaliseWordType } from "@/features/words/types";
import { estimateReadingTime } from "@/features/words/reading-time";

const SAFE_NOTE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const READING_TIME_VERSION = 2;

const memoryMeta = new Map<string, NoteMeta>();
const memoryContent = new Map<string, string>();
const memoryMutationTails = new Map<string, Promise<void>>();

const WORD_MUTATION_LOCK_TTL_MS = 10 * 60 * 1_000;
const WORD_MUTATION_LOCK_WAIT_MS = 30_000;
const RELEASE_WORD_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

function allowWordMemoryPersistence(): boolean {
  return process.env.NODE_ENV !== "production";
}

function getWordRedis() {
  const redis = getRedis();
  if (!redis && !allowWordMemoryPersistence()) {
    throw new Error("Word metadata persistence is unavailable.");
  }
  return redis;
}

function wordObjectStorageAvailable(): boolean {
  const configured = isConfigured();
  if (!configured && !allowWordMemoryPersistence()) {
    throw new Error("Word content storage is unavailable.");
  }
  return configured;
}

export class WordUpdateConflictError extends Error {
  constructor(readonly currentUpdatedAt: string) {
    super("This word was updated elsewhere. Reload to review the latest version before saving.");
    this.name = "WordUpdateConflictError";
  }
}

async function withMemoryWordMutationLock<T>(slug: string, use: () => Promise<T>): Promise<T> {
  const previous = memoryMutationTails.get(slug) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  memoryMutationTails.set(slug, tail);
  await previous;
  try {
    return await use();
  } finally {
    release();
    if (memoryMutationTails.get(slug) === tail) memoryMutationTails.delete(slug);
  }
}

async function withWordMutationLock<T>(slug: string, use: () => Promise<T>): Promise<T> {
  const redis = getWordRedis();
  if (!redis) return withMemoryWordMutationLock(slug, use);

  const key = `${wordMetaKey(slug)}:mutation-lock`;
  const owner = randomUUID();
  const deadline = Date.now() + WORD_MUTATION_LOCK_WAIT_MS;
  let acquired = false;
  do {
    acquired = Boolean(await redis.set(key, owner, { nx: true, px: WORD_MUTATION_LOCK_TTL_MS }));
    if (!acquired) await new Promise((resolve) => setTimeout(resolve, 75));
  } while (!acquired && Date.now() < deadline);
  if (!acquired) throw new Error("This word is still finishing another save. Please try again.");

  try {
    return await use();
  } finally {
    await redis.eval(RELEASE_WORD_LOCK_SCRIPT, [key], [owner]);
  }
}

type ListWordOptions = {
  visibility?: WordVisibility;
  type?: WordType;
  tag?: string;
  q?: string;
  limit?: number;
  cursor?: string;
  includeNonPublic?: boolean;
};

const SINGLE_SEGMENT_IMAGE_REF = /^\/[^/]+\.[a-z0-9]{1,8}$/i;
const LEADING_WORDS_REF = /^\/words\/(?:media|assets)\//i;
const LEADING_ASSETS_REF = /^\/assets\//i;
const TYPED_SLUG_IMAGE_REF = /^\/?(?:blog|note|recipe|review)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(.+)$/i;
const LIKELY_FILE_PATH = /(?:^|\/)[^/]+\.[a-z0-9]{1,8}$/i;
const INTERNAL_ROUTE_PREFIXES = [
  "/pics/",
  "/words/",
  "/t/",
  "/party",
  "/upload",
  "/admin",
  "/api/",
  "/feed.xml",
] as const;

function normaliseTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) return [];
  const cleaned = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  return [...new Set(cleaned)];
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function normaliseImageRef(value?: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  // Support pasting markdown snippets in the image field:
  // ![alt](hero.webp) or ![alt](hero.webp "caption")
  const markdownMatch = trimmed.match(/^!?\[[^\]]*]\((\S+)(?:\s+["'][^"']*["'])?\)$/);
  const ref = markdownMatch ? markdownMatch[1] : trimmed;

  if (SINGLE_SEGMENT_IMAGE_REF.test(ref)) return ref.slice(1);
  if (LEADING_WORDS_REF.test(ref)) return ref.slice(1);
  if (LEADING_ASSETS_REF.test(ref)) return ref.slice(1);
  const typedMatch = ref.match(TYPED_SLUG_IMAGE_REF);
  if (typedMatch) {
    const [, slug, rest] = typedMatch;
    return `words/media/${slug}/${rest}`;
  }
  return ref;
}

function isLikelyFilePath(value: string): boolean {
  return LIKELY_FILE_PATH.test(value);
}

function normaliseMarkdownRefPath(ref: string, slug: string): string {
  const trimmed = ref.trim();
  if (!trimmed) return ref;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return ref;
  if (trimmed.startsWith("#") || trimmed.startsWith("?")) return ref;
  if (/^(javascript|vbscript|data):/i.test(trimmed)) return ref;
  if (trimmed.includes("..")) return ref;

  const normalized = trimmed.replace(/^\/+/, "");
  const normalizedLower = normalized.toLowerCase();

  if (normalizedLower.startsWith("words/media/") || normalizedLower.startsWith("words/assets/")) {
    return normalized;
  }
  if (normalizedLower.startsWith("assets/")) {
    return `words/assets/${normalized.slice("assets/".length)}`;
  }

  const typedMatch = normalized.match(TYPED_SLUG_IMAGE_REF);
  if (typedMatch) {
    const [, typedSlug, rest] = typedMatch;
    return `words/media/${typedSlug}/${rest}`;
  }

  if (
    trimmed.startsWith("/") &&
    INTERNAL_ROUTE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
  ) {
    return trimmed;
  }

  if (!isLikelyFilePath(normalized)) {
    return ref;
  }

  return `words/media/${slug}/${normalized}`;
}

function normaliseMarkdownBody(markdown: string, slug: string): string {
  return markdown.replace(
    /(!?\[[^\]]*\]\()(\S+)(\s+["'][^"']*["'])?(\))/g,
    (_, open, ref, title = "", close) => {
      const nextRef = normaliseMarkdownRefPath(ref, slug);
      return `${open}${nextRef}${title}${close}`;
    },
  );
}

function normaliseNoteMeta(meta: NoteMeta): NoteMeta {
  const type = normaliseWordType(meta.type);
  const visibility = isWordVisibility(meta.visibility) ? meta.visibility : "private";
  const bodyKey =
    typeof meta.bodyKey === "string" && meta.bodyKey.trim()
      ? meta.bodyKey
      : wordContentKey(type, meta.slug);

  return {
    ...meta,
    image: normaliseImageRef(meta.image),
    type,
    bodyKey,
    visibility,
    readingTime:
      Number.isFinite(meta.readingTime) && meta.readingTime > 0
        ? Math.max(1, Math.round(meta.readingTime))
        : 1,
    readingTimeVersion:
      Number.isFinite(meta.readingTimeVersion) && meta.readingTimeVersion > 0
        ? Math.floor(meta.readingTimeVersion)
        : 0,
    tags: normaliseTags(meta.tags),
    featured: !!meta.featured,
  };
}

function isValidWordSlug(slug: string): boolean {
  return SAFE_NOTE_SLUG.test(slug);
}

function storageScopeForVisibility(visibility: WordVisibility): StorageScope {
  return visibility === "private" ? "private" : "public";
}

async function moveWordMediaStorage(
  slug: string,
  sourceScope: StorageScope,
  destinationScope: StorageScope,
): Promise<void> {
  if (sourceScope === destinationScope) return;
  const prefix = `words/media/${slug}/`;
  const [sourceObjects, destinationObjects] = await Promise.all([
    listObjects(prefix, { scope: sourceScope }),
    listObjects(prefix, { scope: destinationScope }),
  ]);
  const sourceKeys = new Set(sourceObjects.map((object) => object.key));

  for (const object of sourceObjects) {
    await copyObject(object.key, object.key, { sourceScope, destinationScope });
  }

  const staleDestinationKeys = destinationObjects
    .map((object) => object.key)
    .filter((key) => !sourceKeys.has(key));
  await deleteObjects(staleDestinationKeys, { scope: destinationScope });
  await deleteObjects([...sourceKeys], { scope: sourceScope });
}

async function writeNoteContent(
  key: string,
  markdown: string,
  visibility: WordVisibility,
): Promise<void> {
  if (wordObjectStorageAvailable()) {
    await uploadBuffer(key, Buffer.from(markdown, "utf-8"), "text/markdown; charset=utf-8", {
      scope: storageScopeForVisibility(visibility),
    });
    return;
  }
  memoryContent.set(key, markdown);
}

async function readContentByKey(key: string, visibility: WordVisibility): Promise<string | null> {
  if (wordObjectStorageAvailable()) {
    try {
      const buf = await downloadBuffer(key, { scope: storageScopeForVisibility(visibility) });
      if (visibility === "private") {
        await deleteObject(key, { scope: "public" });
      }
      return buf.toString("utf-8");
    } catch {
      return null;
    }
  }
  return memoryContent.get(key) ?? null;
}

function candidateContentKeys(meta: Pick<NoteMeta, "slug" | "type" | "bodyKey">): string[] {
  const keys = new Set<string>();
  if (meta.bodyKey?.trim()) keys.add(meta.bodyKey);
  keys.add(wordContentKey(meta.type, meta.slug));
  return [...keys];
}

async function readNoteContent(
  meta: Pick<NoteMeta, "slug" | "type" | "bodyKey" | "visibility">,
): Promise<{ markdown: string; key: string } | null> {
  for (const key of candidateContentKeys(meta)) {
    const markdown = await readContentByKey(key, meta.visibility);
    if (markdown !== null) return { markdown, key };
  }
  return null;
}

function parseRawMeta(raw: unknown): NoteMeta | null {
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? (JSON.parse(raw) as NoteMeta) : (raw as NoteMeta);
    return normaliseNoteMeta(parsed);
  } catch {
    return null;
  }
}

async function deleteNoteContent(keys: string[], scopes: StorageScope[]): Promise<void> {
  const objectStorageAvailable = wordObjectStorageAvailable();
  for (const key of keys) {
    if (objectStorageAvailable) {
      for (const scope of scopes) {
        await deleteObject(key, { scope });
      }
      continue;
    }
    memoryContent.delete(key);
  }
}

async function getAllNoteMetas(): Promise<NoteMeta[]> {
  const redis = getWordRedis();

  if (redis) {
    const slugs = (await redis.smembers(WORD_INDEX_KEY)) as string[];
    if (slugs.length === 0) return [];

    const pipeline = redis.pipeline();
    for (const slug of slugs) {
      pipeline.get(wordMetaKey(slug));
    }
    const raws = await pipeline.exec();
    const metas = raws.map((raw) => parseRawMeta(raw));
    return metas
      .filter((m): m is NoteMeta => m !== null)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  const metas = [...memoryMeta.values()].map((meta) => normaliseNoteMeta(meta));
  return metas.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

async function getWordMeta(slug: string): Promise<NoteMeta | null> {
  if (!isValidWordSlug(slug)) return null;
  const redis = getWordRedis();

  if (redis) {
    const raw = await redis.get<NoteMeta | string>(wordMetaKey(slug));
    return parseRawMeta(raw);
  }

  const meta = memoryMeta.get(slug);
  return meta ? normaliseNoteMeta(meta) : null;
}

async function getWord(slug: string): Promise<NoteRecord | null> {
  const meta = await getWordMeta(slug);
  if (!meta) return null;
  const content = await readNoteContent(meta);
  if (!content) return null;
  const withReadingTime =
    Number.isFinite(meta.readingTime) && meta.readingTime > 0
      ? meta
      : {
          ...meta,
          readingTime: estimateReadingTime(content.markdown),
          readingTimeVersion: READING_TIME_VERSION,
        };
  return { meta: withReadingTime, markdown: content.markdown };
}

async function createWord(input: {
  slug: string;
  title: string;
  subtitle?: string;
  image?: string;
  type?: WordType;
  visibility?: WordVisibility;
  markdown: string;
  tags?: string[];
  featured?: boolean;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
  bodyKey?: string;
}): Promise<NoteRecord> {
  const slug = input.slug.trim().toLowerCase();
  if (!isValidWordSlug(slug)) {
    throw new Error("Invalid slug. Use lowercase letters, numbers, and hyphens.");
  }
  if (!input.title.trim()) throw new Error("Title is required.");
  if (input.visibility !== undefined && !isWordVisibility(input.visibility)) {
    throw new Error("Invalid visibility value.");
  }

  return withWordMutationLock(slug, () => createWordLocked({ ...input, slug }));
}

async function createWordLocked(input: {
  slug: string;
  title: string;
  subtitle?: string;
  image?: string;
  type?: WordType;
  visibility?: WordVisibility;
  markdown: string;
  tags?: string[];
  featured?: boolean;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
  bodyKey?: string;
}): Promise<NoteRecord> {
  const slug = input.slug;
  const existing = await getWordMeta(slug);
  if (existing) throw new Error(`Note "${slug}" already exists.`);

  const nowIso = new Date().toISOString();
  const visibility = input.visibility ?? "private";
  const type = input.type && isWordType(input.type) ? input.type : "note";
  const createdAt = input.createdAt?.trim() || nowIso;
  const updatedAt = input.updatedAt?.trim() || createdAt;
  const bodyKey = input.bodyKey?.trim() || wordContentKey(type, slug);
  const normalisedMarkdown = normaliseMarkdownBody(input.markdown, slug);
  const meta: NoteMeta = {
    slug,
    title: input.title.trim(),
    subtitle: input.subtitle?.trim() || undefined,
    image: normaliseImageRef(input.image),
    type,
    bodyKey,
    visibility,
    createdAt,
    updatedAt,
    readingTime: estimateReadingTime(normalisedMarkdown),
    readingTimeVersion: READING_TIME_VERSION,
    publishedAt: visibility === "public" ? input.publishedAt?.trim() || updatedAt : undefined,
    tags: normaliseTags(input.tags),
    featured: !!input.featured,
    authorRole: "admin",
  };
  await writeNoteContent(meta.bodyKey, normalisedMarkdown, meta.visibility);
  const redis = getWordRedis();
  if (redis) {
    const commit = redis.multi();
    commit.set(wordMetaKey(slug), meta);
    commit.sadd(WORD_INDEX_KEY, slug);
    await commit.exec();
  } else {
    memoryMeta.set(slug, meta);
  }
  return { meta, markdown: normalisedMarkdown };
}

async function updateWord(
  slug: string,
  input: {
    title?: string;
    subtitle?: string | null;
    image?: string | null;
    type?: WordType;
    visibility?: WordVisibility;
    markdown?: string;
    tags?: string[];
    featured?: boolean;
    expectedUpdatedAt?: string;
  },
): Promise<NoteRecord | null> {
  return withWordMutationLock(slug, async () => updateWordLocked(slug, input));
}

async function updateWordLocked(
  slug: string,
  input: {
    title?: string;
    subtitle?: string | null;
    image?: string | null;
    type?: WordType;
    visibility?: WordVisibility;
    markdown?: string;
    tags?: string[];
    featured?: boolean;
    expectedUpdatedAt?: string;
  },
): Promise<NoteRecord | null> {
  if (input.visibility !== undefined && !isWordVisibility(input.visibility)) {
    throw new Error("Invalid visibility value.");
  }
  if (input.title !== undefined && !input.title.trim()) {
    throw new Error("Title is required.");
  }
  const existing = await getWordMeta(slug);
  if (!existing) return null;
  if (input.expectedUpdatedAt && input.expectedUpdatedAt !== existing.updatedAt) {
    throw new WordUpdateConflictError(existing.updatedAt);
  }

  const nextVisibility = input.visibility ?? existing.visibility;
  const nextType = input.type ? normaliseWordType(input.type) : existing.type;
  const nextBodyKey =
    nextType !== existing.type ? wordContentKey(nextType, slug) : existing.bodyKey;
  const nextMarkdown =
    typeof input.markdown === "string" ? normaliseMarkdownBody(input.markdown, slug) : undefined;
  const nextTitle = input.title?.trim() || existing.title;
  const nextSubtitle =
    input.subtitle === null
      ? undefined
      : input.subtitle === undefined
        ? existing.subtitle
        : input.subtitle.trim() || undefined;
  const nextImage =
    input.image === null
      ? undefined
      : input.image === undefined
        ? existing.image
        : normaliseImageRef(input.image);
  const nextTags = input.tags ? normaliseTags(input.tags) : existing.tags;
  const nextFeatured = typeof input.featured === "boolean" ? input.featured : existing.featured;

  const typeChanged = nextType !== existing.type;
  const bodyKeyChanged = nextBodyKey !== existing.bodyKey;
  const titleChanged = nextTitle !== existing.title;
  const subtitleChanged = nextSubtitle !== existing.subtitle;
  const imageChanged = nextImage !== existing.image;
  const visibilityChanged = nextVisibility !== existing.visibility;
  const tagsChanged = !arraysEqual(nextTags, existing.tags);
  const featuredChanged = nextFeatured !== existing.featured;

  const needsContentRead =
    typeof nextMarkdown === "string" || typeChanged || bodyKeyChanged || visibilityChanged;
  const currentContent = needsContentRead ? await readNoteContent(existing) : null;
  const markdownChanged =
    typeof nextMarkdown === "string" && (currentContent?.markdown ?? null) !== nextMarkdown;

  const hasMetadataChanges =
    titleChanged ||
    subtitleChanged ||
    imageChanged ||
    typeChanged ||
    bodyKeyChanged ||
    visibilityChanged ||
    tagsChanged ||
    featuredChanged;

  if (!hasMetadataChanges && !markdownChanged) {
    const existingCurrent = currentContent ?? (await readNoteContent(existing));
    return existingCurrent ? { meta: existing, markdown: existingCurrent.markdown } : null;
  }

  const updatedAt = new Date().toISOString();
  const publishedAt = nextVisibility === "public" ? (existing.publishedAt ?? updatedAt) : undefined;

  const meta: NoteMeta = {
    ...existing,
    title: nextTitle,
    subtitle: nextSubtitle,
    image: nextImage,
    type: nextType,
    bodyKey: nextBodyKey,
    visibility: nextVisibility,
    updatedAt,
    readingTime:
      markdownChanged && typeof nextMarkdown === "string"
        ? estimateReadingTime(nextMarkdown)
        : existing.readingTime,
    readingTimeVersion:
      markdownChanged && typeof nextMarkdown === "string"
        ? READING_TIME_VERSION
        : existing.readingTimeVersion,
    publishedAt,
    tags: nextTags,
    featured: nextFeatured,
  };

  let markdown = markdownChanged && typeof nextMarkdown === "string" ? nextMarkdown : null;
  let sourceKey: string | null = null;
  if (markdown === null && (typeChanged || bodyKeyChanged || visibilityChanged)) {
    markdown = currentContent?.markdown ?? null;
    sourceKey = currentContent?.key ?? null;
  }

  if ((typeChanged || bodyKeyChanged || visibilityChanged) && markdown === null) {
    return null;
  }

  if (markdown !== null) {
    await writeNoteContent(nextBodyKey, markdown, nextVisibility);

    if (wordObjectStorageAvailable()) {
      const nextScope = storageScopeForVisibility(nextVisibility);
      const previousScope = storageScopeForVisibility(existing.visibility);
      if (visibilityChanged) {
        await moveWordMediaStorage(slug, previousScope, nextScope);
      }
      if (nextBodyKey !== existing.bodyKey || nextScope !== previousScope) {
        await deleteObject(existing.bodyKey, { scope: previousScope });
      }
      const oppositeScope: StorageScope = nextScope === "private" ? "public" : "private";
      await deleteObject(nextBodyKey, { scope: oppositeScope });
    }

    const staleKeys = new Set<string>();
    if (existing.bodyKey !== nextBodyKey) staleKeys.add(existing.bodyKey);
    if (sourceKey && sourceKey !== nextBodyKey) staleKeys.add(sourceKey);
    if (nextType !== existing.type) staleKeys.add(wordContentKey(existing.type, slug));
    staleKeys.delete(nextBodyKey);
    if (staleKeys.size > 0) {
      await deleteNoteContent([...staleKeys], ["public", "private"]);
    }
  }

  const redis = getWordRedis();
  if (redis) {
    await redis.set(wordMetaKey(slug), meta);
  } else {
    memoryMeta.set(slug, meta);
  }

  if (typeof input.markdown === "string") {
    return { meta, markdown: markdown ?? "" };
  }

  if (markdown !== null) {
    return { meta, markdown };
  }

  const current = await readNoteContent(meta);
  return current ? { meta, markdown: current.markdown } : null;
}

async function deleteWordMedia(slug: string): Promise<void> {
  if (!wordObjectStorageAvailable()) return;
  const prefix = `words/media/${slug}/`;
  const scopedObjects = await Promise.all(
    (["public", "private"] as const).map(async (scope) => ({
      scope,
      objects: await listObjects(prefix, { scope }),
    })),
  );
  await Promise.all(
    scopedObjects.map(({ scope, objects }) =>
      deleteObjects(
        objects.map((object) => object.key),
        { scope },
      ),
    ),
  );
}

async function deleteWord(slug: string): Promise<boolean> {
  if (!isValidWordSlug(slug)) return false;
  return withWordMutationLock(slug, () => deleteWordLocked(slug));
}

async function deleteWordLocked(slug: string): Promise<boolean> {
  const existing = await getWordMeta(slug);
  if (!existing) return false;
  await deleteWordMedia(slug);
  await deleteNoteContent(candidateContentKeys(existing), ["public", "private"]);
  const redis = getWordRedis();
  if (redis) {
    await deleteAllShareLinksForSlug(slug);
    const commit = redis.multi();
    commit.del(wordMetaKey(slug));
    commit.srem(WORD_INDEX_KEY, slug);
    await commit.exec();
  } else {
    memoryMeta.delete(slug);
    await deleteAllShareLinksForSlug(slug);
  }
  return true;
}

function filterWordMetas(all: NoteMeta[], options: ListWordOptions): NoteMeta[] {
  const q = options.q?.trim().toLowerCase() ?? "";
  const visibility = options.visibility;
  const type = options.type;
  const tag = options.tag?.trim().toLowerCase() ?? "";
  const includeNonPublic = options.includeNonPublic ?? false;

  return all.filter((note) => {
    if (!includeNonPublic && note.visibility !== "public") return false;
    if (visibility && note.visibility !== visibility) return false;
    if (type && note.type !== type) return false;
    if (tag && !note.tags.includes(tag)) return false;
    if (!q) return true;
    const haystack =
      `${note.slug} ${note.title} ${note.subtitle ?? ""} ${note.type} ${note.tags.join(" ")} ${note.featured ? "featured" : ""}`.toLowerCase();
    return haystack.includes(q);
  });
}

async function listWords(
  options: ListWordOptions = {},
): Promise<{ words: NoteMeta[]; nextCursor: string | null }> {
  const filtered = filterWordMetas(await getAllNoteMetas(), options);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

  let start = 0;
  if (options.cursor) {
    const idx = filtered.findIndex((n) => n.slug === options.cursor);
    if (idx >= 0) start = idx + 1;
  }
  const page = filtered.slice(start, start + limit);
  const nextCursor = start + limit < filtered.length ? (page.at(-1)?.slug ?? null) : null;
  return { words: page, nextCursor };
}

async function listAllWords(
  options: Omit<ListWordOptions, "cursor" | "limit"> = {},
): Promise<NoteMeta[]> {
  return filterWordMetas(await getAllNoteMetas(), options);
}

/** Reconcile the discovery index from independently stored metadata; never guess visibility or delete blobs. */
export async function inspectWordPersistence(repairIndex = false) {
  const redis = getWordRedis();
  const indexed = new Set(
    redis ? ((await redis.smembers(WORD_INDEX_KEY)) as string[]) : [...memoryMeta.keys()],
  );
  const records = new Set<string>();
  if (redis) {
    let cursor: string | number = "0";
    do {
      const [next, keys]: [string, string[]] = await redis.scan(cursor, {
        match: "words:meta:*",
        count: 250,
      });
      cursor = next;
      for (const key of keys) {
        const slug = key.slice("words:meta:".length);
        if (isValidWordSlug(slug) && (await getWordMeta(slug))) records.add(slug);
      }
    } while (String(cursor) !== "0");
  } else for (const slug of memoryMeta.keys()) records.add(slug);
  const unindexed = [...records].filter((slug) => !indexed.has(slug));
  const dangling = [...indexed].filter((slug) => !records.has(slug));
  const missingBodies: string[] = [];
  for (const slug of records) if (!(await getWord(slug))) missingBodies.push(slug);
  if (repairIndex && redis) {
    for (const slug of unindexed)
      await redis.eval(
        "if redis.call('exists',KEYS[1]) == 1 then return redis.call('sadd',KEYS[2],ARGV[1]) else return 0 end",
        [wordMetaKey(slug), WORD_INDEX_KEY],
        [slug],
      );
    for (const slug of dangling)
      await redis.eval(
        "if redis.call('exists',KEYS[1]) == 0 then return redis.call('srem',KEYS[2],ARGV[1]) else return 0 end",
        [wordMetaKey(slug), WORD_INDEX_KEY],
        [slug],
      );
  }
  return {
    records: records.size,
    unindexed,
    dangling,
    missingBodies,
    repairRequested: repairIndex,
  };
}

export {
  isValidWordSlug,
  storageScopeForVisibility,
  getWordMeta,
  getWord,
  createWord,
  updateWord,
  deleteWord,
  listWords,
  listAllWords,
};
