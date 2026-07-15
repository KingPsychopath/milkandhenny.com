import { useEffect, useSyncExternalStore } from "react";
import type { OfflineState, OfflineWorkerRequest, OfflineWorkerResponse } from "./protocol";
import { requestPersistentStorage } from "./storage";
import type { OfflineThingSlug } from "@/features/things/offline";

const BUILD_ID = __BUILD_ID__;
const states = new Map<OfflineThingSlug, OfflineState>();
const listeners = new Set<() => void>();
const preparation = new Map<OfflineThingSlug, Promise<void>>();
let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

function publish(slug: OfflineThingSlug, state: OfflineState) {
  if (states.get(slug) === state) return;
  states.set(slug, state);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function waitForPageLoad() {
  if (document.readyState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) =>
    window.addEventListener("load", () => resolve(), { once: true }),
  );
}

export function registerOfflinePlatform() {
  if (registrationPromise) return registrationPromise;
  registrationPromise = (async () => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return null;
    await waitForPageLoad();
    await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    return navigator.serviceWorker.ready;
  })().catch(() => null);
  return registrationPromise;
}

async function sendWorkerMessage(
  message: OfflineWorkerRequest,
): Promise<OfflineWorkerResponse | null> {
  const registration = await registerOfflinePlatform();
  const worker = navigator.serviceWorker?.controller ?? registration?.active ?? null;
  if (!worker) return null;

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => resolve(null), 30_000);
    channel.port1.onmessage = (event: MessageEvent<OfflineWorkerResponse>) => {
      window.clearTimeout(timeout);
      resolve(event.data);
    };
    worker.postMessage(message, [channel.port2]);
  });
}

function collectCurrentPageResources() {
  const urls = new Set<string>();
  const add = (value: string) => {
    try {
      const url = new URL(value, location.href);
      if (url.origin === location.origin) urls.add(url.href);
    } catch {
      // Ignore malformed browser resource entries.
    }
  };

  add(location.pathname);
  for (const element of document.querySelectorAll<HTMLScriptElement>("script[src]"))
    add(element.src);
  for (const element of document.querySelectorAll<HTMLLinkElement>("link[href]")) add(element.href);
  for (const entry of performance.getEntriesByType("resource")) add(entry.name);
  return [...urls];
}

export async function refreshOfflineState(slug: OfflineThingSlug) {
  const response = await sendWorkerMessage({
    type: "CHECK_THING_OFFLINE",
    slug,
    buildId: BUILD_ID,
  });
  publish(slug, response?.state ?? "unavailable");
}

export function prepareThingOffline(slug: OfflineThingSlug) {
  const existing = preparation.get(slug);
  if (existing) return existing;

  const pending = (async () => {
    await refreshOfflineState(slug);
    if (states.get(slug) === "ready") return;
    publish(slug, "preparing");
    const response = await sendWorkerMessage({
      type: "PREPARE_THING_OFFLINE",
      slug,
      buildId: BUILD_ID,
      resourceUrls: collectCurrentPageResources(),
    });
    publish(slug, response?.state ?? "failed");
    if (response?.state === "ready") void requestPersistentStorage();
  })().finally(() => preparation.delete(slug));

  preparation.set(slug, pending);
  return pending;
}

export function useThingOfflineState(slug: OfflineThingSlug) {
  useEffect(() => {
    void refreshOfflineState(slug);
  }, [slug]);

  return useSyncExternalStore(
    subscribe,
    () => states.get(slug) ?? "not-ready",
    () => "unavailable",
  );
}
