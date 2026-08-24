import type { OfflineThingSlug } from "@/features/things/offline";

export interface OfflineCacheMetadata {
  offlineVersion: number;
  resourceUrls: string[];
  storageVersion: number;
  preparedAt: number;
}

export type OfflineReadiness = "not-ready" | "update-available" | "ready";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isOfflineCacheMetadata(value: unknown): value is OfflineCacheMetadata {
  if (!isRecord(value)) return false;
  return (
    typeof value.offlineVersion === "number" &&
    Number.isInteger(value.offlineVersion) &&
    value.offlineVersion > 0 &&
    typeof value.storageVersion === "number" &&
    Number.isInteger(value.storageVersion) &&
    value.storageVersion > 0 &&
    typeof value.preparedAt === "number" &&
    Number.isFinite(value.preparedAt) &&
    Array.isArray(value.resourceUrls) &&
    value.resourceUrls.every((url): url is string => typeof url === "string")
  );
}

export function isCurrentOfflineCacheMetadata(
  metadata: OfflineCacheMetadata,
  thing: { offlineVersion: number; storageVersion: number },
) {
  return (
    metadata.offlineVersion === thing.offlineVersion &&
    metadata.storageVersion === thing.storageVersion
  );
}

export function containsResourceUrls(
  availableUrls: readonly string[],
  requiredUrls: readonly string[],
) {
  const available = new Set(availableUrls);
  return requiredUrls.every((url) => available.has(url));
}

export function getOfflineReadiness(
  caches: readonly OfflineCacheMetadata[],
  thing: { offlineVersion: number; storageVersion: number },
  requiredResourceUrls?: readonly string[],
): OfflineReadiness {
  const hasCurrentCache = caches.some(
    (metadata) =>
      isCurrentOfflineCacheMetadata(metadata, thing) &&
      (requiredResourceUrls === undefined ||
        containsResourceUrls(metadata.resourceUrls, requiredResourceUrls)),
  );
  if (hasCurrentCache) return "ready";
  return caches.length > 0 ? "update-available" : "not-ready";
}

export function offlineCacheKey(slug: OfflineThingSlug, offlineVersion: number) {
  return `mah-thing-offline:${slug}:v${offlineVersion}`;
}
