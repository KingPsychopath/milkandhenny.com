"use client";

import {
  getStorageKey,
  SESSION_KEYS,
  LOCAL_KEYS,
  type StorageKeyName,
} from "@/lib/shared/storage-keys";

function getStore(name: StorageKeyName): Storage {
  return name in SESSION_KEYS ? sessionStorage : localStorage;
}

/** Read a value. Returns null on server or if missing. */
export function getStored(name: StorageKeyName): string | null {
  if (typeof window === "undefined") return null;
  return getStore(name).getItem(getStorageKey(name));
}

/** Write a value. No-op on server. */
export function setStored(name: StorageKeyName, value: string): void {
  if (typeof window === "undefined") return;
  getStore(name).setItem(getStorageKey(name), value);
}

/** Remove a value. No-op on server. */
export function removeStored(name: StorageKeyName): void {
  if (typeof window === "undefined") return;
  getStore(name).removeItem(getStorageKey(name));
}

export type { StorageKeyName };
export { SESSION_KEYS, LOCAL_KEYS, getStorageKey };

