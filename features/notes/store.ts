import "server-only";

import { deleteObject, downloadBuffer, isConfigured, uploadBuffer } from "@/lib/platform/r2";
import { getRedis } from "@/lib/platform/redis";
import { NOTE_INDEX_KEY, legacyNoteContentKey, noteContentKey, noteMetaKey } from "./config";
import { deleteAllShareLinksForSlug } from "./share";
import type { NoteMeta, NoteRecord, NoteVisibility } from "./types";
import type { WordType } from "@/features/words/types";
import { isWordType, normaliseWordType } from "@/features/words/types";

const SAFE_NOTE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const memoryMeta = new Map<string, NoteMeta>();
const memoryContent = new Map<string, string>();

type ListNoteOptions = {
  visibility?: NoteVisibility;
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
const INTERNAL_ROUTE_PREFIXES = ["/pics/", "/words/", "/t/", "/party", "/upload", "/admin", "/api/", "/feed.xml"] as const;

function normaliseTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) return [];
  const cleaned = tags
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(cleaned)];
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

  if (trimmed.startsWith("/") && INTERNAL_ROUTE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return trimmed;
  }

  if (!isLikelyFilePath(normalized)) {
    return ref;
  }

  return `words/media/${slug}/${normalized}`;
}

function normaliseMarkdownBody(markdown: string, slug: string): string {
  return markdown.replace(/(!?\[[^\]]*\]\()(\S+)(\s+["'][^"']*["'])?(\))/g, (_, open, ref, title = "", close) => {
    const nextRef = normaliseMarkdownRefPath(ref, slug);
    return `${open}${nextRef}${title}${close}`;
  });
}

function normaliseNoteMeta(meta: NoteMeta): NoteMeta {
  const type = normaliseWordType(meta.type);
  const bodyKey =
    typeof meta.bodyKey === "string" && meta.bodyKey.trim()
      ? meta.bodyKey
      : noteContentKey(type, meta.slug);

  return {
    ...meta,
    image: normaliseImageRef(meta.image),
    type,
    bodyKey,
    tags: normaliseTags(meta.tags),
    featured: !!meta.featured,
  };
}

function isValidNoteSlug(slug: string): boolean {
  return SAFE_NOTE_SLUG.test(slug);
}

async function writeNoteContent(key: string, markdown: string): Promise<void> {
  if (isConfigured()) {
    await uploadBuffer(key, Buffer.from(markdown, "utf-8"), "text/markdown; charset=utf-8");
    return;
  }
  memoryContent.set(key, markdown);
}

async function readContentByKey(key: string): Promise<string | null> {
  if (isConfigured()) {
    try {
      const buf = await downloadBuffer(key);
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
  keys.add(noteContentKey(meta.type, meta.slug));
  keys.add(legacyNoteContentKey(meta.slug));
  return [...keys];
}

async function readNoteContent(meta: Pick<NoteMeta, "slug" | "type" | "bodyKey">): Promise<{ markdown: string; key: string } | null> {
  for (const key of candidateContentKeys(meta)) {
    const markdown = await readContentByKey(key);
    if (markdown !== null) return { markdown, key };
  }
  return null;
}

async function deleteNoteContent(keys: string[]): Promise<void> {
  for (const key of keys) {
    if (isConfigured()) {
      try {
        await deleteObject(key);
      } catch {
        // Best-effort cleanup; metadata deletion is source of truth.
      }
      continue;
    }
    memoryContent.delete(key);
  }
}

async function getAllNoteMetas(): Promise<NoteMeta[]> {
  const redis = getRedis();

  if (redis) {
    const slugs = (await redis.smembers(NOTE_INDEX_KEY)) as string[];
    if (slugs.length === 0) return [];
    const metas = await Promise.all(
      slugs.map(async (slug) => {
        const raw = await redis.get<NoteMeta | string>(noteMetaKey(slug));
        if (!raw) return null;
        const parsed = typeof raw === "string" ? (JSON.parse(raw) as NoteMeta) : raw;
        return normaliseNoteMeta(parsed);
      })
    );
    return metas
      .filter((m): m is NoteMeta => m !== null)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  return [...memoryMeta.values()]
    .map((meta) => normaliseNoteMeta(meta))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

async function getNoteMeta(slug: string): Promise<NoteMeta | null> {
  if (!isValidNoteSlug(slug)) return null;
  const redis = getRedis();

  if (redis) {
    const raw = await redis.get<NoteMeta | string>(noteMetaKey(slug));
    if (!raw) return null;
    const parsed = typeof raw === "string" ? (JSON.parse(raw) as NoteMeta) : raw;
    return normaliseNoteMeta(parsed);
  }

  const meta = memoryMeta.get(slug);
  return meta ? normaliseNoteMeta(meta) : null;
}

async function getNote(slug: string): Promise<NoteRecord | null> {
  const meta = await getNoteMeta(slug);
  if (!meta) return null;
  const content = await readNoteContent(meta);
  if (!content) return null;
  return { meta, markdown: content.markdown };
}

async function createNote(input: {
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
}): Promise<NoteRecord> {
  const slug = input.slug.trim().toLowerCase();
  if (!isValidNoteSlug(slug)) {
    throw new Error("Invalid slug. Use lowercase letters, numbers, and hyphens.");
  }
  if (!input.title.trim()) throw new Error("Title is required.");

  const existing = await getNoteMeta(slug);
  if (existing) throw new Error(`Note "${slug}" already exists.`);

  const nowIso = new Date().toISOString();
  const visibility = input.visibility ?? "private";
  const type = input.type && isWordType(input.type) ? input.type : "note";
  const createdAt = input.createdAt?.trim() || nowIso;
  const updatedAt = input.updatedAt?.trim() || createdAt;
  const bodyKey = input.bodyKey?.trim() || noteContentKey(type, slug);
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
    publishedAt:
      visibility === "public"
        ? input.publishedAt?.trim() || updatedAt
        : undefined,
    tags: normaliseTags(input.tags),
    featured: !!input.featured,
    authorRole: "admin",
  };
  const normalisedMarkdown = normaliseMarkdownBody(input.markdown, slug);

  const redis = getRedis();
  if (redis) {
    await redis.set(noteMetaKey(slug), meta);
    await redis.sadd(NOTE_INDEX_KEY, slug);
  } else {
    memoryMeta.set(slug, meta);
  }

  await writeNoteContent(meta.bodyKey, normalisedMarkdown);
  return { meta, markdown: normalisedMarkdown };
}

async function updateNote(
  slug: string,
  input: {
    title?: string;
    subtitle?: string | null;
    image?: string | null;
    type?: WordType;
    visibility?: NoteVisibility;
    markdown?: string;
    tags?: string[];
    featured?: boolean;
  }
): Promise<NoteRecord | null> {
  const existing = await getNoteMeta(slug);
  if (!existing) return null;

  const nextVisibility = input.visibility ?? existing.visibility;
  const updatedAt = new Date().toISOString();
  const nextType = input.type ? normaliseWordType(input.type) : existing.type;
  const nextBodyKey =
    nextType !== existing.type ? noteContentKey(nextType, slug) : existing.bodyKey;

  const meta: NoteMeta = {
    ...existing,
    title: input.title?.trim() || existing.title,
    subtitle:
      input.subtitle === null
        ? undefined
        : input.subtitle === undefined
          ? existing.subtitle
          : input.subtitle.trim() || undefined,
    image:
      input.image === null
        ? undefined
        : input.image === undefined
          ? existing.image
          : normaliseImageRef(input.image),
    type: nextType,
    bodyKey: nextBodyKey,
    visibility: nextVisibility,
    updatedAt,
    publishedAt:
      nextVisibility === "public"
        ? existing.publishedAt ?? updatedAt
        : undefined,
    tags: input.tags ? normaliseTags(input.tags) : existing.tags,
    featured: typeof input.featured === "boolean" ? input.featured : existing.featured,
  };

  const redis = getRedis();
  if (redis) {
    await redis.set(noteMetaKey(slug), meta);
  } else {
    memoryMeta.set(slug, meta);
  }

  let markdown =
    typeof input.markdown === "string" ? normaliseMarkdownBody(input.markdown, slug) : null;
  let sourceKey: string | null = null;
  if (markdown === null && (nextType !== existing.type || nextBodyKey !== existing.bodyKey)) {
    const current = await readNoteContent(existing);
    markdown = current?.markdown ?? null;
    sourceKey = current?.key ?? null;
  }

  if (markdown !== null) {
    await writeNoteContent(nextBodyKey, markdown);
    const staleKeys = new Set<string>();
    if (existing.bodyKey !== nextBodyKey) staleKeys.add(existing.bodyKey);
    if (sourceKey && sourceKey !== nextBodyKey) staleKeys.add(sourceKey);
    if (nextType !== existing.type) staleKeys.add(noteContentKey(existing.type, slug));
    if (typeof input.markdown === "string") staleKeys.add(legacyNoteContentKey(slug));
    staleKeys.delete(nextBodyKey);
    if (staleKeys.size > 0) {
      await deleteNoteContent([...staleKeys]);
    }
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

async function deleteNote(slug: string): Promise<boolean> {
  const existing = await getNoteMeta(slug);
  if (!existing) return false;
  const redis = getRedis();
  if (redis) {
    await Promise.all([
      redis.del(noteMetaKey(slug)),
      redis.srem(NOTE_INDEX_KEY, slug),
      deleteAllShareLinksForSlug(slug),
    ]);
  } else {
    memoryMeta.delete(slug);
    await deleteAllShareLinksForSlug(slug);
  }
  await deleteNoteContent(candidateContentKeys(existing));
  return true;
}

async function listNotes(options: ListNoteOptions = {}): Promise<{ notes: NoteMeta[]; nextCursor: string | null }> {
  const all = await getAllNoteMetas();
  const q = options.q?.trim().toLowerCase() ?? "";
  const visibility = options.visibility;
  const type = options.type;
  const tag = options.tag?.trim().toLowerCase() ?? "";
  const includeNonPublic = options.includeNonPublic ?? false;
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

  const filtered = all.filter((note) => {
    if (!includeNonPublic && note.visibility !== "public") return false;
    if (visibility && note.visibility !== visibility) return false;
    if (type && note.type !== type) return false;
    if (tag && !note.tags.includes(tag)) return false;
    if (!q) return true;
    const haystack = `${note.slug} ${note.title} ${note.subtitle ?? ""} ${note.type} ${note.tags.join(" ")} ${note.featured ? "featured" : ""}`.toLowerCase();
    return haystack.includes(q);
  });

  let start = 0;
  if (options.cursor) {
    const idx = filtered.findIndex((n) => n.slug === options.cursor);
    if (idx >= 0) start = idx + 1;
  }
  const page = filtered.slice(start, start + limit);
  const nextCursor = filtered[start + limit]?.slug ?? null;
  return { notes: page, nextCursor };
}

export {
  isValidNoteSlug,
  getNoteMeta,
  getNote,
  createNote,
  updateNote,
  deleteNote,
  listNotes,
};
