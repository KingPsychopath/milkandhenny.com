import { useEffect, useSyncExternalStore } from "react";
import type { OfflineState, OfflineWorkerRequest, OfflineWorkerResponse } from "./protocol";
import { requestPersistentStorage } from "./storage";
import type { OfflineThingSlug } from "@/features/things/offline";

const BUILD_ID = __BUILD_ID__;
const states = new Map<OfflineThingSlug, OfflineState>();
const listeners = new Set<() => void>();
const preparation = new Map<OfflineThingSlug, Promise<void>>();
let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
type SiteUpdateState = "idle" | "ready" | "activating" | "updated" | "failed";
const UPDATE_RELOAD_KEY = "milkandhenny:site-update-reload";
const ACTIVATION_TIMEOUT_MS = 10_000;
// A refresh adopts the update that is waiting then, plus one that finishes installing moments
// later. Anything that lands after this window belongs to ordinary browsing and has to ask.
const REFRESH_ADOPTION_WINDOW_MS = 60_000;
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

function reloadForSiteUpdate() {
  try {
    sessionStorage.setItem(UPDATE_RELOAD_KEY, "1");
  } catch {
    // A blocked session store should not prevent the update.
  }
  location.reload();
}

function showCompletedUpdate() {
  try {
    if (sessionStorage.getItem(UPDATE_RELOAD_KEY) !== "1") return;
    sessionStorage.removeItem(UPDATE_RELOAD_KEY);
    publishSiteUpdate("updated");
  } catch {
    // A blocked session store only removes the completion message.
  }
}

function isReloadNavigation() {
  const navigation = performance.getEntriesByType("navigation")[0];
  return navigation !== undefined && "type" in navigation && navigation.type === "reload";
}

function completeActivation() {
  if (!reloadForUpdate) return;
  reloadForUpdate = false;
  clearActivationTimeout();
  reloadForSiteUpdate();
}

function activateWaitingWorker(
  worker: ServiceWorker,
  registration?: ServiceWorkerRegistration | null,
) {
  if (reloadForUpdate && waitingWorker === worker) return true;
  if (worker.state === "activated") {
    reloadForSiteUpdate();
    return true;
  }
  reloadForUpdate = true;
  publishSiteUpdate("activating", worker);
  clearActivationTimeout();
  // `controllerchange` is the usual signal that the new worker took over, but it is not dependable
  // on its own: Safari skips it often enough that waiting for it alone leaves the notice spinning
  // on "updating…" until it gives up. Take the worker reaching "activated" as an equal signal.
  worker.addEventListener("statechange", () => {
    if (worker.state === "activated" && waitingWorker === worker) completeActivation();
  });
  activationTimeout = window.setTimeout(() => {
    activationTimeout = null;
    // Before reporting a failure, ask the worker itself rather than trusting that an event
    // arrived. If it did take over, reload; a missed event is not a failed update.
    if (worker.state === "activated" || registration?.active === worker) {
      completeActivation();
      return;
    }
    reloadForUpdate = false;
    publishSiteUpdate("failed", worker);
  }, ACTIVATION_TIMEOUT_MS);
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

function observeRegistration(registration: ServiceWorkerRegistration, activateOnReady: boolean) {
  const openedAt = Date.now();
  // Refreshing means "reload this app", so an update waiting right then is adopted without asking.
  // That consent does not extend to the rest of the visit: an update that lands while someone is
  // reading, playing or editing must never pull the page out from under them.
  const adoptsUpdate = () => activateOnReady && Date.now() - openedAt < REFRESH_ADOPTION_WINDOW_MS;
  const showWaitingUpdate = () => {
    if (registration.waiting && navigator.serviceWorker.controller) {
      if (adoptsUpdate()) {
        activateWaitingWorker(registration.waiting, registration);
        return;
      }
      publishSiteUpdate("ready", registration.waiting);
    }
  };
  const watchInstalling = (installing: ServiceWorker | null) => {
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed") showWaitingUpdate();
    });
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => completeActivation());
  showWaitingUpdate();
  watchInstalling(registration.installing);
  registration.addEventListener("updatefound", () => watchInstalling(registration.installing));
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
    showCompletedUpdate();
    await waitForPageLoad();
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    observeRegistration(registration, isReloadNavigation());
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
  return activateWaitingWorker(worker, registration);
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

export function prepareThingOffline(
  slug: OfflineThingSlug,
  options?: { refresh?: boolean },
): Promise<void> {
  const existing = preparation.get(slug);
  if (existing) {
    return options?.refresh ? existing.then(() => prepareThingOffline(slug, options)) : existing;
  }

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
