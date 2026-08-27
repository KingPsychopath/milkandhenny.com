import {
  deleteObjects,
  isConfigured,
  listObjects,
  type StorageScope,
} from "@/lib/platform/r2.server";
import { listWords, storageScopeForVisibility } from "@/features/words/store.server";

type FolderAggregate = {
  scope: StorageScope;
  slug: string;
  objectCount: number;
  totalBytes: number;
  latestModifiedAt: string | null;
  keys?: string[];
};

type WordMediaOrphanFolder = {
  scope: StorageScope;
  slug: string;
  objectCount: number;
  totalBytes: number;
  latestModifiedAt: string | null;
};

type WordMediaOrphanSummary = {
  r2Configured: boolean;
  scannedFolders: number;
  linkedWords: number;
  orphanFolders: number;
  orphanObjects: number;
  orphanBytes: number;
  orphans: WordMediaOrphanFolder[];
};

type WordMediaOrphanCleanupResult = {
  r2Configured: boolean;
  scannedFolders: number;
  linkedWords: number;
  orphanFolders: number;
  targetFolders: number;
  deletedFolders: number;
  deletedObjects: number;
  deletedBytes: number;
  staleIncomingCandidates: number;
  deletedIncomingObjects: number;
  deletedIncomingBytes: number;
  cleanedAt: string;
};

const STALE_INCOMING_MIN_AGE_MS = 24 * 60 * 60 * 1000;

function toIsoOrNull(value: Date | undefined): string | null {
  if (!value) return null;
  const ts = value.getTime();
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

function compareLatest(a: string | null, b: string | null): number {
  const aTs = a ? new Date(a).getTime() : 0;
  const bTs = b ? new Date(b).getTime() : 0;
  return bTs - aTs;
}

async function listAllWordScopes(): Promise<Map<string, StorageScope>> {
  const scopes = new Map<string, StorageScope>();
  let cursor: string | undefined;
  let loops = 0;

  while (loops < 5000) {
    const page = await listWords({
      includeNonPublic: true,
      limit: 100,
      cursor,
    });
    for (const note of page.words) {
      scopes.set(note.slug, storageScopeForVisibility(note.visibility));
    }
    if (!page.nextCursor || page.nextCursor === cursor) {
      break;
    }
    cursor = page.nextCursor;
    loops += 1;
  }

  return scopes;
}

async function collectWordMediaFolders(includeKeys: boolean): Promise<FolderAggregate[]> {
  const scopedObjects = await Promise.all(
    (["public", "private"] as const).map(async (scope) => ({
      scope,
      objects: await listObjects("words/media/", { scope }),
    })),
  );
  const bySlug = new Map<string, FolderAggregate>();

  for (const { scope, objects } of scopedObjects) {
    for (const object of objects) {
      const parts = object.key.split("/");
      if (parts.length < 4) continue;
      if (parts[0] !== "words" || parts[1] !== "media") continue;

      const slug = parts[2]?.trim();
      if (!slug) continue;

      const aggregateKey = `${scope}:${slug}`;
      const existing = bySlug.get(aggregateKey);
      if (!existing) {
        bySlug.set(aggregateKey, {
          scope,
          slug,
          objectCount: 1,
          totalBytes: object.size,
          latestModifiedAt: toIsoOrNull(object.lastModified),
          keys: includeKeys ? [object.key] : undefined,
        });
        continue;
      }

      existing.objectCount += 1;
      existing.totalBytes += object.size;
      if (includeKeys && existing.keys) {
        existing.keys.push(object.key);
      }

      const currentLatest = existing.latestModifiedAt;
      const candidate = toIsoOrNull(object.lastModified);
      if (
        !currentLatest ||
        (candidate && new Date(candidate).getTime() > new Date(currentLatest).getTime())
      ) {
        existing.latestModifiedAt = candidate;
      }
    }
  }

  return [...bySlug.values()].sort(
    (a, b) =>
      b.objectCount - a.objectCount || compareLatest(a.latestModifiedAt, b.latestModifiedAt),
  );
}

async function scanOrphanWordMediaFolders(options?: {
  limit?: number;
}): Promise<WordMediaOrphanSummary> {
  if (!isConfigured()) {
    return {
      r2Configured: false,
      scannedFolders: 0,
      linkedWords: 0,
      orphanFolders: 0,
      orphanObjects: 0,
      orphanBytes: 0,
      orphans: [],
    };
  }

  const [linkedScopes, folders] = await Promise.all([
    listAllWordScopes(),
    collectWordMediaFolders(false),
  ]);

  const orphanFolders = folders.filter((folder) => linkedScopes.get(folder.slug) !== folder.scope);
  const orphanObjects = orphanFolders.reduce((sum, folder) => sum + folder.objectCount, 0);
  const orphanBytes = orphanFolders.reduce((sum, folder) => sum + folder.totalBytes, 0);
  const limit = Math.max(1, Math.min(options?.limit ?? 50, 500));

  return {
    r2Configured: true,
    scannedFolders: folders.length,
    linkedWords: linkedScopes.size,
    orphanFolders: orphanFolders.length,
    orphanObjects,
    orphanBytes,
    orphans: orphanFolders.slice(0, limit).map((folder) => ({
      scope: folder.scope,
      slug: folder.slug,
      objectCount: folder.objectCount,
      totalBytes: folder.totalBytes,
      latestModifiedAt: folder.latestModifiedAt,
    })),
  };
}

async function cleanupOrphanWordMediaFolders(): Promise<WordMediaOrphanCleanupResult> {
  if (!isConfigured()) {
    return {
      r2Configured: false,
      scannedFolders: 0,
      linkedWords: 0,
      orphanFolders: 0,
      targetFolders: 0,
      deletedFolders: 0,
      deletedObjects: 0,
      deletedBytes: 0,
      staleIncomingCandidates: 0,
      deletedIncomingObjects: 0,
      deletedIncomingBytes: 0,
      cleanedAt: new Date().toISOString(),
    };
  }

  const [linkedScopes, folders] = await Promise.all([
    listAllWordScopes(),
    collectWordMediaFolders(true),
  ]);

  const orphanFolders = folders.filter((folder) => linkedScopes.get(folder.slug) !== folder.scope);
  let deletedFolders = 0;
  let deletedObjects = 0;
  let deletedBytes = 0;
  let staleIncomingCandidates = 0;
  let deletedIncomingObjects = 0;
  let deletedIncomingBytes = 0;

  for (const folder of orphanFolders) {
    const keys = folder.keys ?? [];
    if (keys.length === 0) continue;
    deletedObjects += await deleteObjects(keys, { scope: folder.scope });
    deletedBytes += folder.totalBytes;
    deletedFolders += 1;
  }

  const nowMs = Date.now();
  const staleIncomingObjects = (await listObjects("incoming/words/", { scope: "private" })).filter(
    (obj) => !!obj.lastModified && nowMs - obj.lastModified.getTime() >= STALE_INCOMING_MIN_AGE_MS,
  );

  staleIncomingCandidates = staleIncomingObjects.length;
  if (staleIncomingCandidates > 0) {
    const incomingKeys = staleIncomingObjects.map((obj) => obj.key);
    deletedIncomingObjects = await deleteObjects(incomingKeys, { scope: "private" });
    deletedIncomingBytes = staleIncomingObjects.reduce((sum, obj) => sum + obj.size, 0);
  }

  return {
    r2Configured: true,
    scannedFolders: folders.length,
    linkedWords: linkedScopes.size,
    orphanFolders: orphanFolders.length,
    targetFolders: orphanFolders.length,
    deletedFolders,
    deletedObjects,
    deletedBytes,
    staleIncomingCandidates,
    deletedIncomingObjects,
    deletedIncomingBytes,
    cleanedAt: new Date().toISOString(),
  };
}

export { scanOrphanWordMediaFolders, cleanupOrphanWordMediaFolders };

export type { WordMediaOrphanFolder, WordMediaOrphanSummary, WordMediaOrphanCleanupResult };
