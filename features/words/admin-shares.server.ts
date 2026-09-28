import { listShareLinks } from "./share.server";
import { listAllWords } from "./store.server";
import type { WordType } from "./types";
import type { WordVisibility } from "./content-types";

export type SharedWordSummary = {
  slug: string;
  title: string;
  type: WordType;
  visibility: WordVisibility;
  activeShareCount: number;
  pinProtectedCount: number;
  nextExpiryAt: string;
};

function isLinkActive(link: { revokedAt?: string; expiresAt: string }): boolean {
  return !link.revokedAt && new Date(link.expiresAt).getTime() > Date.now();
}

export async function buildSharedWordSummaries(): Promise<SharedWordSummary[]> {
  const words = await listAllWords({ includeNonPublic: true });
  const summaries = await Promise.all(
    words.map(async (note) => {
      const active = (await listShareLinks(note.slug)).filter(isLinkActive);
      if (active.length === 0) return null;
      let nextExpiryAt = active[0]?.expiresAt ?? note.updatedAt;
      for (const link of active) {
        if (new Date(link.expiresAt).getTime() < new Date(nextExpiryAt).getTime()) {
          nextExpiryAt = link.expiresAt;
        }
      }
      return {
        slug: note.slug,
        title: note.title,
        type: note.type,
        visibility: note.visibility,
        activeShareCount: active.length,
        pinProtectedCount: active.filter((link) => link.pinRequired).length,
        nextExpiryAt,
      } satisfies SharedWordSummary;
    }),
  );
  return summaries
    .filter((item): item is SharedWordSummary => !!item)
    .sort((a, b) => new Date(a.nextExpiryAt).getTime() - new Date(b.nextExpiryAt).getTime());
}
