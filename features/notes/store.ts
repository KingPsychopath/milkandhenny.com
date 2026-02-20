import "server-only";

import { deleteObject, downloadBuffer, isConfigured, uploadBuffer } from "@/lib/platform/r2";
import { getRedis } from "@/lib/platform/redis";
import { NOTE_INDEX_KEY, noteContentKey, noteMetaKey } from "./config";
import type { NoteMeta, NoteRecord, NoteVisibility } from "./types";

const SAFE_NOTE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const memoryMeta = new Map<string, NoteMeta>();
const memoryContent = new Map<string, string>();

type ListNoteOptions = {
  visibility?: NoteVisibility;
  q?: string;
  limit?: number;
  cursor?: string;
  includeNonPublic?: boolean;
};

function isValidNoteSlug(slug: string): boolean {
  return SAFE_NOTE_SLUG.test(slug);
}

async function writeNoteContent(slug: string, markdown: string): Promise<void> {
  const key = noteContentKey(slug);
  if (isConfigured()) {
    await uploadBuffer(key, Buffer.from(markdown, "utf-8"), "text/markdown; charset=utf-8");
    return;
  }
  memoryContent.set(key, markdown);
}

async function readNoteContent(slug: string): Promise<string | null> {
  const key = noteContentKey(slug);
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

async function deleteNoteContent(slug: string): Promise<void> {
  const key = noteContentKey(slug);
  if (isConfigured()) {
    try {
      await deleteObject(key);
    } catch {
      // Best-effort cleanup; metadata deletion is source of truth.
    }
    return;
  }
  memoryContent.delete(key);
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
        return typeof raw === "string" ? (JSON.parse(raw) as NoteMeta) : raw;
      })
    );
    return metas
      .filter((m): m is NoteMeta => m !== null)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  return [...memoryMeta.values()].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

async function getNoteMeta(slug: string): Promise<NoteMeta | null> {
  if (!isValidNoteSlug(slug)) return null;
  const redis = getRedis();

  if (redis) {
    const raw = await redis.get<NoteMeta | string>(noteMetaKey(slug));
    if (!raw) return null;
    return typeof raw === "string" ? (JSON.parse(raw) as NoteMeta) : raw;
  }

  return memoryMeta.get(slug) ?? null;
}

async function getNote(slug: string): Promise<NoteRecord | null> {
  const meta = await getNoteMeta(slug);
  if (!meta) return null;
  const markdown = await readNoteContent(slug);
  if (markdown === null) return null;
  return { meta, markdown };
}

async function createNote(input: {
  slug: string;
  title: string;
  subtitle?: string;
  visibility?: NoteVisibility;
  markdown: string;
  tags?: string[];
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
  const meta: NoteMeta = {
    slug,
    title: input.title.trim(),
    subtitle: input.subtitle?.trim() || undefined,
    visibility,
    createdAt: nowIso,
    updatedAt: nowIso,
    publishedAt: visibility === "public" ? nowIso : undefined,
    tags: input.tags?.filter(Boolean),
    authorRole: "admin",
  };

  const redis = getRedis();
  if (redis) {
    await redis.set(noteMetaKey(slug), meta);
    await redis.sadd(NOTE_INDEX_KEY, slug);
  } else {
    memoryMeta.set(slug, meta);
  }

  await writeNoteContent(slug, input.markdown);
  return { meta, markdown: input.markdown };
}

async function updateNote(
  slug: string,
  input: {
    title?: string;
    subtitle?: string | null;
    visibility?: NoteVisibility;
    markdown?: string;
    tags?: string[];
  }
): Promise<NoteRecord | null> {
  const existing = await getNoteMeta(slug);
  if (!existing) return null;

  const nextVisibility = input.visibility ?? existing.visibility;
  const updatedAt = new Date().toISOString();

  const meta: NoteMeta = {
    ...existing,
    title: input.title?.trim() || existing.title,
    subtitle:
      input.subtitle === null
        ? undefined
        : input.subtitle === undefined
          ? existing.subtitle
          : input.subtitle.trim() || undefined,
    visibility: nextVisibility,
    updatedAt,
    publishedAt:
      nextVisibility === "public"
        ? existing.publishedAt ?? updatedAt
        : undefined,
    tags: input.tags ?? existing.tags,
  };

  const redis = getRedis();
  if (redis) {
    await redis.set(noteMetaKey(slug), meta);
  } else {
    memoryMeta.set(slug, meta);
  }

  if (typeof input.markdown === "string") {
    await writeNoteContent(slug, input.markdown);
  }

  const markdown = typeof input.markdown === "string" ? input.markdown : await readNoteContent(slug);
  return markdown === null ? null : { meta, markdown };
}

async function deleteNote(slug: string): Promise<boolean> {
  const existing = await getNoteMeta(slug);
  if (!existing) return false;
  const redis = getRedis();
  if (redis) {
    await Promise.all([redis.del(noteMetaKey(slug)), redis.srem(NOTE_INDEX_KEY, slug)]);
  } else {
    memoryMeta.delete(slug);
  }
  await deleteNoteContent(slug);
  return true;
}

async function listNotes(options: ListNoteOptions = {}): Promise<{ notes: NoteMeta[]; nextCursor: string | null }> {
  const all = await getAllNoteMetas();
  const q = options.q?.trim().toLowerCase() ?? "";
  const visibility = options.visibility;
  const includeNonPublic = options.includeNonPublic ?? false;
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

  const filtered = all.filter((note) => {
    if (!includeNonPublic && note.visibility !== "public") return false;
    if (visibility && note.visibility !== visibility) return false;
    if (!q) return true;
    const haystack = `${note.slug} ${note.title} ${note.subtitle ?? ""}`.toLowerCase();
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
