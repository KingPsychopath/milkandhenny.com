import { BASE_URL } from "@/lib/shared/config";
import { Effect } from "effect";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
import { MediaMaintenanceService } from "@/features/system/media-maintenance-service.server";
import { buildWordShareUrl } from "@/features/words/routes";
import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
  updateShareLink,
} from "@/features/words/share.server";
import { getWord, getWordMeta, listWords } from "@/features/words/store.server";
import { WordOperationsService } from "@/features/words/word-operations-service.server";
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
  return runMediaEffect(
    Effect.gen(function* () {
      return yield* (yield* WordOperationsService).create(input);
    }),
  );
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
  return runMediaEffect(
    Effect.gen(function* () {
      return yield* (yield* WordOperationsService).update(slug, input);
    }),
  );
}

async function deleteWordRecord(slug: string) {
  return runMediaEffect(
    Effect.gen(function* () {
      return yield* (yield* WordOperationsService).delete(slug);
    }),
  );
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

async function cleanupWordShares(slug?: string) {
  return runMediaEffect(
    Effect.gen(function* () {
      return yield* (yield* MediaMaintenanceService).cleanupWordShares(slug);
    }),
  );
}

async function purgeWordShares(slug?: string) {
  return runMediaEffect(
    Effect.gen(function* () {
      return yield* (yield* MediaMaintenanceService).purgeWordShares(slug);
    }),
  );
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
