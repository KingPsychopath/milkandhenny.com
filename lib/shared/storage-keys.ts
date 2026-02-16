/**
 * Centralised browser storage keys and helpers.
 *
 * Keys are grouped in SESSION_KEYS and LOCAL_KEYS. Use getStored / setStored / removeStored
 * with the key name so storage type is decided in one place — swap session ↔ local by moving
 * the name between the two objects. Each name must exist in exactly one object.
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

const _sessionNames = new Set(Object.keys(SESSION_KEYS));
const _localNames = new Set(Object.keys(LOCAL_KEYS));
for (const name of _sessionNames) {
  if (_localNames.has(name)) {
    throw new Error(`Storage key "${name}" must exist in only one of SESSION_KEYS or LOCAL_KEYS.`);
  }
}

export function getStorageKey(name: StorageKeyName): string {
  return name in SESSION_KEYS
    ? SESSION_KEYS[name as keyof typeof SESSION_KEYS]
    : LOCAL_KEYS[name as keyof typeof LOCAL_KEYS];
}
