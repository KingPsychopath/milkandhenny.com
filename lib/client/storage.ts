"use client";

import { getStorageKey, LOCAL_KEYS, type StorageKeyName } from "@/lib/shared/storage-keys";

/** Read a value. Returns null on server or if missing. */
export function getStored(name: StorageKeyName): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(getStorageKey(name));
  } catch {
    return null;
  }
}

/** Write a value. Returns false when browser storage is unavailable. */
export function setStored(name: StorageKeyName, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(getStorageKey(name), value);
    return true;
  } catch {
    // Storage may be blocked or unavailable in a private browser context.
    return false;
  }
}

/** Remove a value. No-op on server. */
export function removeStored(name: StorageKeyName): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(getStorageKey(name));
  } catch {
    // Treat unavailable storage as already empty.
  }
}

export type { StorageKeyName };
export { LOCAL_KEYS, getStorageKey };
