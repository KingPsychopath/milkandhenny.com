/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core";
import { registerRoute } from "workbox-routing";
import {
  getOfflineReadiness,
  isCurrentOfflineCacheMetadata,
  isOfflineCacheMetadata,
  offlineCacheKey,
  type OfflineCacheMetadata,
} from "@/features/offline/cache-metadata";
import type { OfflineWorkerRequest, OfflineWorkerResponse } from "@/features/offline/protocol";
import {
  THING_OFFLINE,
  getOfflineThingByPath,
  isOfflineThingSlug,
  type OfflineThingSlug,
} from "@/features/things/offline";

declare const self: ServiceWorkerGlobalScope;

const BUILD_ID = __BUILD_ID__;
const CACHE_PREFIX = "mah-thing-offline";
const OPTIONAL_AI_CACHE = `mah-optional-ai:${safeBuildId()}`;
const preparations = new Map<OfflineThingSlug, Promise<boolean>>();

clientsClaim();

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        const oldOptionalAi = name.startsWith("mah-optional-ai:") && name !== OPTIONAL_AI_CACHE;
        const abandonedStaging = name.startsWith(`${CACHE_PREFIX}:`) && name.endsWith(":staging");
        if (oldOptionalAi || abandonedStaging) await caches.delete(name);
      }
      await removeIncompleteThingCaches();
    })(),
  );
});

function safeBuildId() {
  return BUILD_ID.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function cachePrefix(slug: OfflineThingSlug) {
  return `${CACHE_PREFIX}:${slug}:`;
}

function candidateCacheName(slug: OfflineThingSlug) {
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${offlineCacheKey(slug, THING_OFFLINE[slug].offlineVersion)}:${safeBuildId()}:${nonce}`;
}

function metadataUrl(slug: OfflineThingSlug) {
  return new URL(`/__offline_metadata__/${slug}`, self.location.origin).href;
}

function offlineThingForPath(pathname: string) {
  return getOfflineThingByPath(pathname);
}

function isPlayerJoinPath(pathname: string) {
  return /^\/things\/play\/[A-Z2-9]{7}$/i.test(pathname);
}

function isCacheableAssetPath(pathname: string) {
  return (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/_build/") ||
    pathname.startsWith("/fonts/") ||
    pathname === "/favicon.ico" ||
    pathname === "/apple-icon.png" ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/manifest")
  );
}

function isOptionalAiAsset(pathname: string) {
  return pathname.startsWith("/assets/whisper.worker-") || pathname.startsWith("/assets/ort-wasm-");
}

function normaliseResourceUrl(value: string, slug: OfflineThingSlug) {
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) return null;
    const thing = THING_OFFLINE[slug];
    if (url.pathname !== thing.entryPath && !isCacheableAssetPath(url.pathname)) return null;
    url.hash = "";
    if (url.pathname === thing.entryPath) url.search = "";
    return url.href;
  } catch {
    return null;
  }
}

function offlineThingSlugs() {
  return Object.keys(THING_OFFLINE).filter(isOfflineThingSlug);
}

async function thingCacheNames(slug: OfflineThingSlug) {
  const prefix = cachePrefix(slug);
  return (await caches.keys()).filter((name) => name.startsWith(prefix));
}

async function readMetadata(
  slug: OfflineThingSlug,
  cacheName: string,
): Promise<OfflineCacheMetadata | null> {
  const cache = await caches.open(cacheName);
  const response = await cache.match(metadataUrl(slug));
  if (!response) return null;
  try {
    const value: unknown = await response.json();
    return isOfflineCacheMetadata(value) ? value : null;
  } catch {
    return null;
  }
}

async function cacheContainsResources(cacheName: string, metadata: OfflineCacheMetadata) {
  const cache = await caches.open(cacheName);
  for (const url of metadata.resourceUrls) {
    if (!(await cache.match(url))) return false;
  }
  return true;
}

interface ReadyThingCache {
  name: string;
  slug: OfflineThingSlug;
  metadata: OfflineCacheMetadata;
}

async function thingCachesWithMetadata(slug?: OfflineThingSlug): Promise<ReadyThingCache[]> {
  const slugs = slug ? [slug] : offlineThingSlugs();
  const entries: ReadyThingCache[] = [];
  for (const currentSlug of slugs) {
    for (const name of await thingCacheNames(currentSlug)) {
      const metadata = await readMetadata(currentSlug, name);
      if (!metadata) continue;
      entries.push({ name, slug: currentSlug, metadata });
    }
  }
  return entries.toSorted((left, right) => {
    const currentRelease =
      Number(isCurrentOfflineCacheMetadata(right.metadata, THING_OFFLINE[right.slug])) -
      Number(isCurrentOfflineCacheMetadata(left.metadata, THING_OFFLINE[left.slug]));
    return currentRelease || right.metadata.preparedAt - left.metadata.preparedAt;
  });
}

async function matchThingCaches(request: Request, slug?: OfflineThingSlug) {
  for (const entry of await thingCachesWithMetadata(slug)) {
    const response = await (await caches.open(entry.name)).match(request);
    if (response) return response;
  }
  return null;
}

async function readyThingCaches(slug?: OfflineThingSlug): Promise<ReadyThingCache[]> {
  const entries: ReadyThingCache[] = [];
  for (const entry of await thingCachesWithMetadata(slug)) {
    if (await cacheContainsResources(entry.name, entry.metadata)) entries.push(entry);
  }
  return entries;
}

function resourceUrlsForThing(values: readonly string[], slug: OfflineThingSlug) {
  const resourceUrls = new Set<string>();
  for (const value of values) {
    const url = normaliseResourceUrl(value, slug);
    if (url) resourceUrls.add(url);
  }
  return [...resourceUrls];
}

async function isReady(slug: OfflineThingSlug, expectedResourceUrls?: readonly string[]) {
  const expected = expectedResourceUrls
    ? resourceUrlsForThing(expectedResourceUrls, slug)
    : undefined;
  const entries = await readyThingCaches(slug);
  return (
    getOfflineReadiness(
      entries.map((entry) => entry.metadata),
      THING_OFFLINE[slug],
      expected,
    ) === "ready"
  );
}

async function offlineReadiness(slug: OfflineThingSlug, expectedResourceUrls?: readonly string[]) {
  const expected = expectedResourceUrls
    ? resourceUrlsForThing(expectedResourceUrls, slug)
    : undefined;
  const entries = await readyThingCaches(slug);
  return getOfflineReadiness(
    entries.map((entry) => entry.metadata),
    THING_OFFLINE[slug],
    expected,
  );
}

async function removeIncompleteThingCaches() {
  for (const slug of offlineThingSlugs()) {
    for (const name of await thingCacheNames(slug)) {
      if (!(await readMetadata(slug, name))) await caches.delete(name);
    }
  }
}

async function cacheResource(cache: Cache, url: string, slug: OfflineThingSlug) {
  const request = new Request(url, {
    cache: "reload",
    // Offline entry points and assets are public. Omitting credentials keeps
    // a signed-in browser from persisting a cookie-personalized response.
    credentials: "omit",
    redirect: "follow",
  });
  const response = await fetch(request);
  if (!response.ok || response.redirected || response.type === "opaque") {
    throw new Error(`Unable to cache ${new URL(url).pathname}`);
  }
  if (
    new URL(url).pathname === THING_OFFLINE[slug].entryPath &&
    !response.headers.get("content-type")?.includes("text/html")
  ) {
    throw new Error("Offline entry point did not return HTML");
  }
  await cache.put(request, response);
}

async function performThingPreparation(
  slug: OfflineThingSlug,
  pageResources: string[],
  refresh = false,
) {
  const thing = THING_OFFLINE[slug];
  const resourceUrls = resourceUrlsForThing(
    [thing.entryPath, ...thing.requiredAssets, ...pageResources.slice(0, 200)],
    slug,
  );
  if (!refresh && (await isReady(slug, resourceUrls))) return true;

  const candidateName = candidateCacheName(slug);
  try {
    const candidate = await caches.open(candidateName);
    await Promise.all(resourceUrls.map((url) => cacheResource(candidate, url, slug)));

    const metadata: OfflineCacheMetadata = {
      offlineVersion: thing.offlineVersion,
      resourceUrls,
      storageVersion: thing.storageVersion,
      preparedAt: Date.now(),
    };
    await candidate.put(
      metadataUrl(slug),
      Response.json(metadata, { headers: { "Cache-Control": "no-store" } }),
    );
    if (!(await cacheContainsResources(candidateName, metadata))) {
      throw new Error("Offline cache became incomplete");
    }

    for (const name of await thingCacheNames(slug)) {
      if (name === candidateName) continue;
      try {
        await caches.delete(name);
      } catch {
        // A stale cache is harmless if the new cache is already complete.
      }
    }
    return true;
  } catch {
    await caches.delete(candidateName);
    return false;
  }
}

function prepareThing(slug: OfflineThingSlug, pageResources: string[], refresh = false) {
  const existing = preparations.get(slug);
  if (existing) return existing;

  const preparation = performThingPreparation(slug, pageResources, refresh).finally(() => {
    preparations.delete(slug);
  });
  preparations.set(slug, preparation);
  return preparation;
}

async function removeThing(slug: OfflineThingSlug) {
  for (const name of await caches.keys()) {
    if (name.startsWith(cachePrefix(slug))) await caches.delete(name);
  }
}

function parseWorkerRequest(value: unknown): OfflineWorkerRequest | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (typeof message.type !== "string" || typeof message.slug !== "string") return null;
  if (!isOfflineThingSlug(message.slug)) return null;
  if (message.type === "REMOVE_THING_OFFLINE") {
    return { type: message.type, slug: message.slug };
  }
  if (typeof message.buildId !== "string") return null;
  if (message.type === "CHECK_THING_OFFLINE") {
    if (message.resourceUrls !== undefined && !isStringArray(message.resourceUrls)) return null;
    return {
      type: message.type,
      slug: message.slug,
      buildId: message.buildId,
      resourceUrls: message.resourceUrls,
    };
  }
  if (message.type === "PREPARE_THING_OFFLINE" && isStringArray(message.resourceUrls)) {
    return {
      type: message.type,
      slug: message.slug,
      buildId: message.buildId,
      resourceUrls: message.resourceUrls,
      refresh: message.refresh === true,
    };
  }
  return null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
    return;
  }
  const message = parseWorkerRequest(event.data);
  const port = event.ports[0];
  if (!message || !port) return;

  event.waitUntil(
    (async () => {
      let response: OfflineWorkerResponse;
      if (message.type === "REMOVE_THING_OFFLINE") {
        await removeThing(message.slug);
        response = { ok: true, state: "not-ready", buildId: BUILD_ID };
      } else if (message.buildId !== BUILD_ID) {
        response = {
          ok: false,
          state: "not-ready",
          buildId: BUILD_ID,
          error: "A newer site version is waiting to activate",
        };
      } else if (message.type === "CHECK_THING_OFFLINE") {
        const readiness = await offlineReadiness(message.slug, message.resourceUrls);
        response = {
          ok: readiness === "ready",
          state: preparations.has(message.slug) ? "preparing" : readiness,
          buildId: BUILD_ID,
        };
      } else {
        const ready = await prepareThing(message.slug, message.resourceUrls, message.refresh);
        response = {
          ok: ready,
          state: ready ? "ready" : "failed",
          buildId: BUILD_ID,
          error: ready ? undefined : "The offline download is incomplete",
        };
      }
      port.postMessage(response);
    })(),
  );
});

registerRoute(
  ({ request, url }) => request.method === "GET" && isOptionalAiAsset(url.pathname),
  async ({ request }) => {
    const cache = await caches.open(OPTIONAL_AI_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  },
);

registerRoute(
  ({ request, url }) => request.mode === "navigate" && isPlayerJoinPath(url.pathname),
  async ({ request }) => {
    try {
      return await fetch(request);
    } catch {
      // A player can still open the locally installed game when the network is unavailable.
    }
    for (const slug of ["heads-up", "spelling-bee"] as const) {
      const canonicalRequest = new Request(
        new URL(THING_OFFLINE[slug].entryPath, self.location.origin),
      );
      const cached = await matchThingCaches(canonicalRequest, slug);
      if (cached) return cached;
    }
    return Response.error();
  },
);

registerRoute(
  ({ request, url }) => request.mode === "navigate" && Boolean(offlineThingForPath(url.pathname)),
  async ({ request, url }) => {
    const match = offlineThingForPath(url.pathname);
    if (!match) return fetch(request);
    const slug = match[0] as OfflineThingSlug;
    const canonicalRequest = new Request(new URL(match[1].entryPath, self.location.origin));
    try {
      return await fetch(request);
    } catch {
      return (await matchThingCaches(canonicalRequest, slug)) ?? Response.error();
    }
  },
);

registerRoute(
  ({ request, url }) => request.method === "GET" && isCacheableAssetPath(url.pathname),
  async ({ request }) => (await matchThingCaches(request)) ?? fetch(request),
);
