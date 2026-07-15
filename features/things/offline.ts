export const OFFLINE_FONT_ASSETS = [
  "/fonts/geist-latin-v5.woff2",
  "/fonts/geist-latin-ext-v5.woff2",
  "/fonts/geist-mono-latin-v6.woff2",
  "/fonts/geist-mono-latin-ext-v6.woff2",
  "/fonts/lora-latin-v37.woff2",
  "/fonts/lora-latin-ext-v37.woff2",
  "/fonts/lora-italic-latin-v37.woff2",
  "/fonts/lora-italic-latin-ext-v37.woff2",
] as const;

const SHARED_OFFLINE_ASSETS = [
  ...OFFLINE_FONT_ASSETS,
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
] as const;

export const THING_OFFLINE = {
  "heads-up": {
    entryPath: "/things/heads-up",
    manifestPath: "/manifest-forehead.webmanifest",
    catalogueVersion: 1,
    storageVersion: 1,
    requiredAssets: [...SHARED_OFFLINE_ASSETS, "/manifest-forehead.webmanifest"],
  },
  icebreaker: {
    entryPath: "/things/icebreaker",
    manifestPath: "/manifest.json",
    catalogueVersion: 1,
    storageVersion: 1,
    requiredAssets: [...SHARED_OFFLINE_ASSETS, "/manifest.json"],
  },
} as const;

export type OfflineThingSlug = keyof typeof THING_OFFLINE;

export function isOfflineThingSlug(value: string): value is OfflineThingSlug {
  return Object.hasOwn(THING_OFFLINE, value);
}

export function getOfflineThingByPath(pathname: string) {
  return Object.entries(THING_OFFLINE).find(([, thing]) => thing.entryPath === pathname);
}
