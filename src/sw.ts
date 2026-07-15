/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core";
import { registerRoute } from "workbox-routing";
import type {
  OfflineWorkerRequest,
  OfflineWorkerResponse,
} from "@/features/offline/protocol";
import {
  THING_OFFLINE,
  isOfflineThingSlug,
  type OfflineThingSlug,
} from "@/features/things/offline";

declare const self: ServiceWorkerGlobalScope;

const BUILD_ID = __BUILD_ID__;
const CACHE_PREFIX = "mah-thing-offline";
const OPTIONAL_AI_CACHE = `mah-optional-ai:${safeBuildId()}`;
const preparations = new Map<OfflineThingSlug, Promise<boolean>>();

clientsClaim();

function safeBuildId() {
  return BUILD_ID.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function cachePrefix(slug: OfflineThingSlug) {
  return `${CACHE_PREFIX}:${slug}:`;
}

function currentCacheName(slug: OfflineThingSlug) {
  return `${cachePrefix(slug)}${safeBuildId()}`;
}

function stagingCacheName(slug: OfflineThingSlug) {
  return `${currentCacheName(slug)}:staging`;
}

function metadataUrl(slug: OfflineThingSlug) {
  return new URL(`/__offline_metadata__/${slug}`, self.location.origin).href;
}

function offlineThingForPath(pathname: string) {
  return Object.entries(THING_OFFLINE).find(
    ([, thing]) => thing.entryPath === pathname,
  );
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
    if (url.pathname !== thing.entryPath && !isCacheableAssetPath(url.pathname))
      return null;
    url.hash = "";
    if (url.pathname === thing.entryPath) url.search = "";
    return url.href;
  } catch {
    return null;
  }
}

async function thingCacheNames(slug?: OfflineThingSlug) {
  const prefix = slug ? cachePrefix(slug) : `${CACHE_PREFIX}:`;
  const names = (await caches.keys()).filter(
    (name) => name.startsWith(prefix) && !name.endsWith(":staging"),
  );
  return names.toReversed();
}

async function matchThingCaches(request: Request, slug?: OfflineThingSlug) {
  for (const name of await thingCacheNames(slug)) {
    const response = await (await caches.open(name)).match(request);
    if (response) return response;
  }
  return null;
}

interface OfflineMetadata {
  buildId: string;
  catalogueVersion: number;
  resourceUrls: string[];
  storageVersion: number;
}

async function readMetadata(
  slug: OfflineThingSlug,
): Promise<OfflineMetadata | null> {
  const cache = await caches.open(currentCacheName(slug));
  const response = await cache.match(metadataUrl(slug));
  if (!response) return null;
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object") return null;
    const metadata = value as Partial<OfflineMetadata>;
    if (
      metadata.buildId !== BUILD_ID ||
      metadata.catalogueVersion !== THING_OFFLINE[slug].catalogueVersion ||
      metadata.storageVersion !== THING_OFFLINE[slug].storageVersion ||
      !Array.isArray(metadata.resourceUrls) ||
      !metadata.resourceUrls.every((url) => typeof url === "string")
    ) {
      return null;
    }
    return {
      buildId: metadata.buildId,
      catalogueVersion: metadata.catalogueVersion,
      resourceUrls: metadata.resourceUrls,
      storageVersion: metadata.storageVersion,
    };
  } catch {
    return null;
  }
}

async function isReady(slug: OfflineThingSlug) {
  const metadata = await readMetadata(slug);
  if (!metadata) return false;
  const cache = await caches.open(currentCacheName(slug));
  for (const url of metadata.resourceUrls) {
    if (!(await cache.match(url))) return false;
  }
  return true;
}

async function cacheResource(
  cache: Cache,
  url: string,
  slug: OfflineThingSlug,
) {
  const request = new Request(url, {
    cache: "reload",
    credentials: "same-origin",
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
  if (!refresh && await isReady(slug)) return true;

  const thing = THING_OFFLINE[slug];
  const resourceUrls = new Set<string>();
  for (const value of [
    thing.entryPath,
    ...thing.requiredAssets,
    ...pageResources.slice(0, 200),
  ]) {
    const url = normaliseResourceUrl(value, slug);
    if (url) resourceUrls.add(url);
  }

  const stagingName = stagingCacheName(slug);
  const finalName = currentCacheName(slug);
  try {
    await caches.delete(stagingName);
    const staging = await caches.open(stagingName);
    await Promise.all(
      [...resourceUrls].map((url) => cacheResource(staging, url, slug)),
    );

    await caches.delete(finalName);
    const finalCache = await caches.open(finalName);
    for (const request of await staging.keys()) {
      const response = await staging.match(request);
      if (!response) throw new Error("Offline staging cache became incomplete");
      await finalCache.put(request, response);
    }

    const metadata: OfflineMetadata = {
      buildId: BUILD_ID,
      catalogueVersion: thing.catalogueVersion,
      resourceUrls: [...resourceUrls],
      storageVersion: thing.storageVersion,
    };
    await finalCache.put(
      metadataUrl(slug),
      Response.json(metadata, { headers: { "Cache-Control": "no-store" } }),
    );
    await caches.delete(stagingName);

    for (const name of await thingCacheNames(slug)) {
      if (name !== finalName) await caches.delete(name);
    }
    return isReady(slug);
  } catch {
    await caches.delete(stagingName);
    if (!(await isReady(slug))) await caches.delete(finalName);
    return false;
  }
}

function prepareThing(slug: OfflineThingSlug, pageResources: string[], refresh = false) {
  const existing = preparations.get(slug);
  if (existing) return existing;

  const preparation = performThingPreparation(slug, pageResources, refresh).finally(
    () => {
      preparations.delete(slug);
    },
  );
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
  if (typeof message.type !== "string" || typeof message.slug !== "string")
    return null;
  if (!isOfflineThingSlug(message.slug)) return null;
  if (message.type === "REMOVE_THING_OFFLINE") {
    return { type: message.type, slug: message.slug };
  }
  if (typeof message.buildId !== "string") return null;
  if (message.type === "CHECK_THING_OFFLINE") {
    return { type: message.type, slug: message.slug, buildId: message.buildId };
  }
  if (
    message.type === "PREPARE_THING_OFFLINE" &&
    Array.isArray(message.resourceUrls) &&
    message.resourceUrls.every((url) => typeof url === "string")
  ) {
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

self.addEventListener("message", (event) => {
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
        const ready = await isReady(message.slug);
        response = {
          ok: ready,
          state: preparations.has(message.slug)
            ? "preparing"
            : ready
              ? "ready"
              : "not-ready",
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
    for (const slug of ["heads-up", "spelling-bee"] as const) {
      const canonicalRequest = new Request(new URL(THING_OFFLINE[slug].entryPath, self.location.origin));
      const cached = await matchThingCaches(canonicalRequest, slug);
      if (cached) return cached;
    }
    return fetch(request);
  },
);

registerRoute(
  ({ request, url }) =>
    request.mode === "navigate" && Boolean(offlineThingForPath(url.pathname)),
  async ({ request, url }) => {
    const match = offlineThingForPath(url.pathname);
    if (!match) return fetch(request);
    const slug = match[0] as OfflineThingSlug;
    const canonicalRequest = new Request(
      new URL(match[1].entryPath, self.location.origin),
    );
    return (await matchThingCaches(canonicalRequest, slug)) ?? fetch(request);
  },
);

registerRoute(
  ({ request, url }) =>
    request.method === "GET" && isCacheableAssetPath(url.pathname),
  async ({ request }) => (await matchThingCaches(request)) ?? fetch(request),
);
