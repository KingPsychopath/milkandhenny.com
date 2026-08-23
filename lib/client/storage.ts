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

/** Remove a value. Returns false when browser storage is unavailable. */
export function removeStored(name: StorageKeyName): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.removeItem(getStorageKey(name));
    return true;
  } catch {
    return false;
  }
}

export type { StorageKeyName };
export { LOCAL_KEYS, getStorageKey };
