/**
 * Centralised browser storage keys and helpers.
 *
 * Keys are grouped in SESSION_KEYS and LOCAL_KEYS. Use getStored / setStored / removeStored
 * with the key name so storage type is decided in one place — swap session ↔ local by moving
 * the name between the two objects.
 *
 * Layout's inline script cannot call helpers; it uses LOCAL_KEYS.theme for the key string.
 */

/** Keys for sessionStorage — cleared when the tab closes. */
export const SESSION_KEYS = {
  staffToken: "mah-staff-token",
  adminToken: "mah-admin-token",
  uploadToken: "mah-upload-token",
} as const;

/** Keys for localStorage — persists across tabs and sessions. */
export const LOCAL_KEYS = {
  theme: "theme",
  bestDressedVote: "mah-best-dressed-vote",
  icebreakerColor: "mah-icebreaker-color",
  swipeHintCount: "mah-swipe-hint-count",
} as const;

export type StorageKeyName = keyof typeof SESSION_KEYS | keyof typeof LOCAL_KEYS;

function getStore(name: StorageKeyName): Storage {
  return name in SESSION_KEYS ? sessionStorage : localStorage;
}

function getKey(name: StorageKeyName): string {
  return name in SESSION_KEYS
    ? SESSION_KEYS[name as keyof typeof SESSION_KEYS]
    : LOCAL_KEYS[name as keyof typeof LOCAL_KEYS];
}

/** Read a value. Returns null on server or if missing. */
export function getStored(name: StorageKeyName): string | null {
  if (typeof window === "undefined") return null;
  return getStore(name).getItem(getKey(name));
}

/** Write a value. No-op on server. */
export function setStored(name: StorageKeyName, value: string): void {
  if (typeof window === "undefined") return;
  getStore(name).setItem(getKey(name), value);
}

/** Remove a value. No-op on server. */
export function removeStored(name: StorageKeyName): void {
  if (typeof window === "undefined") return;
  getStore(name).removeItem(getKey(name));
}
