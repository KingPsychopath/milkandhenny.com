import { useEffect, useSyncExternalStore } from "react";
import type { OfflineState, OfflineWorkerRequest, OfflineWorkerResponse } from "./protocol";
import { requestPersistentStorage } from "./storage";
import type { OfflineThingSlug } from "@/features/things/offline";

const BUILD_ID = __BUILD_ID__;
const states = new Map<OfflineThingSlug, OfflineState>();
const listeners = new Set<() => void>();
const preparation = new Map<OfflineThingSlug, Promise<void>>();
let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
type SiteUpdateState = "idle" | "ready" | "activating" | "failed";
let siteUpdateState: SiteUpdateState = "idle";
let waitingWorker: ServiceWorker | null = null;
let reloadForUpdate = false;
let activationTimeout: number | null = null;
const updateListeners = new Set<() => void>();

function clearActivationTimeout() {
  if (activationTimeout === null) return;
  window.clearTimeout(activationTimeout);
  activationTimeout = null;
}

function publishSiteUpdate(state: SiteUpdateState, worker?: ServiceWorker | null) {
  if (worker !== undefined) waitingWorker = worker;
  if (siteUpdateState === state) return;
  siteUpdateState = state;
  for (const listener of updateListeners) listener();
}

function observeRegistration(registration: ServiceWorkerRegistration) {
  const showWaitingUpdate = () => {
    if (registration.waiting && navigator.serviceWorker.controller) {
      publishSiteUpdate("ready", registration.waiting);
    }
  };
  const watchInstalling = (installing: ServiceWorker | null) => {
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed") showWaitingUpdate();
    });
  };
  showWaitingUpdate();
  watchInstalling(registration.installing);
  registration.addEventListener("updatefound", () => watchInstalling(registration.installing));
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!reloadForUpdate) return;
    reloadForUpdate = false;
    clearActivationTimeout();
    location.reload();
  });
}

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
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    observeRegistration(registration);
    void registration.update();
    return navigator.serviceWorker.ready;
  })().catch(() => null);
  return registrationPromise;
}

export function useSiteUpdateState() {
  return useSyncExternalStore(
    (listener) => {
      updateListeners.add(listener);
      return () => updateListeners.delete(listener);
    },
    () => siteUpdateState,
    () => "idle" as const,
  );
}

export async function activateSiteUpdate() {
  const registration = await registerOfflinePlatform();
  const worker = registration?.waiting ?? waitingWorker;
  if (!worker) {
    publishSiteUpdate("failed");
    return false;
  }
  if (worker.state === "activated") {
    location.reload();
    return true;
  }
  reloadForUpdate = true;
  publishSiteUpdate("activating", worker);
  clearActivationTimeout();
  activationTimeout = window.setTimeout(() => {
    reloadForUpdate = false;
    activationTimeout = null;
    publishSiteUpdate("failed", worker);
  }, 10_000);
  try {
    // ServiceWorker.postMessage has no targetOrigin argument.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    worker.postMessage({ type: "SKIP_WAITING" });
  } catch {
    reloadForUpdate = false;
    clearActivationTimeout();
    publishSiteUpdate("failed", worker);
    return false;
  }
  return true;
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

export function prepareThingOffline(slug: OfflineThingSlug, options?: { refresh?: boolean }) {
  const existing = preparation.get(slug);
  if (existing) return existing;

  const pending = (async () => {
    await refreshOfflineState(slug);
    if (states.get(slug) === "ready" && !options?.refresh) return;
    publish(slug, "preparing");
    const response = await sendWorkerMessage({
      type: "PREPARE_THING_OFFLINE",
      slug,
      buildId: BUILD_ID,
      resourceUrls: collectCurrentPageResources(),
      refresh: options?.refresh,
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
