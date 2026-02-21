import "server-only";

import { BASE_URL } from "@/lib/shared/config";
import {
  cleanupShareLinksForSlug,
  createShareLink,
  deleteAllShareLinksForSlug,
  listShareLinks,
  listTrackedShareSlugs,
  revokeShareLink,
  updateShareLink,
} from "@/features/notes/share";
import { createNote, deleteNote, getNote, listNotes, updateNote } from "@/features/notes/store";
import type { NoteVisibility } from "@/features/notes/types";
import type { WordType } from "@/features/words/types";

type CreateNoteInput = {
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

type UpdateNoteInput = {
  title?: string;
  subtitle?: string | null;
  image?: string | null;
  type?: WordType;
  visibility?: NoteVisibility;
  markdown?: string;
  tags?: string[];
  featured?: boolean;
};

async function createNoteRecord(input: CreateNoteInput) {
  return createNote(input);
}

async function listNoteRecords(options?: {
  visibility?: NoteVisibility;
  type?: WordType;
  tag?: string;
  q?: string;
  limit?: number;
  includeNonPublic?: boolean;
}) {
  return listNotes({
    visibility: options?.visibility,
    type: options?.type,
    tag: options?.tag,
    q: options?.q,
    limit: options?.limit ?? 100,
    includeNonPublic: options?.includeNonPublic ?? true,
  });
}

async function getNoteRecord(slug: string) {
  return getNote(slug);
}

async function updateNoteRecord(slug: string, input: UpdateNoteInput) {
  return updateNote(slug, input);
}

async function deleteNoteRecord(slug: string) {
  return deleteNote(slug);
}

async function createNoteShare(
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

async function listNoteShares(slug: string) {
  return listShareLinks(slug);
}

async function updateNoteShare(
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

async function revokeNoteShare(slug: string, id: string) {
  return revokeShareLink(slug, id);
}

async function collectShareSlugs(slug?: string): Promise<string[]> {
  if (slug) return [slug];
  const [tracked, notesResult] = await Promise.all([
    listTrackedShareSlugs(),
    listNotes({ includeNonPublic: true, limit: 2000 }),
  ]);
  const slugs = new Set<string>(tracked);
  for (const note of notesResult.notes) {
    slugs.add(note.slug);
  }
  return [...slugs].sort();
}

async function cleanupNoteShares(slug?: string) {
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

async function purgeNoteShares(slug?: string) {
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

async function resetNoteShares() {
  return purgeNoteShares();
}

export {
  createNoteRecord,
  listNoteRecords,
  getNoteRecord,
  updateNoteRecord,
  deleteNoteRecord,
  createNoteShare,
  listNoteShares,
  updateNoteShare,
  revokeNoteShare,
  cleanupNoteShares,
  purgeNoteShares,
  resetNoteShares,
};
