import "server-only";

import { BASE_URL } from "@/lib/shared/config";
import { createShareLink, listShareLinks, revokeShareLink, updateShareLink } from "@/features/notes/share";
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
};
