/**
 * Centralised browser storage keys and helpers.
 *
 * Use getStored / setStored / removeStored with these names for small, site-wide localStorage
 * values. Feature-scoped browser state owns its keys beside the feature.
 *
 * Layout's inline script cannot call helpers; it uses LOCAL_KEYS.theme for the key string.
 */

/** Keys for localStorage — persists across tabs and sessions. */
export const LOCAL_KEYS = {
  theme: "theme",
  browserProfile: "mah-browser-profile-v1",
  bestDressedVote: "mah-best-dressed-vote",
  icebreakerColor: "mah-icebreaker-color",
  icebreakerLedger: "mah-icebreaker-ledger",
  icebreakerPlayerId: "mah-icebreaker-player-id",
  swipeHintCount: "mah-swipe-hint-count",
  mapProvider: "mah-map-provider",
} as const;

export type StorageKeyName = keyof typeof LOCAL_KEYS;

export function getStorageKey(name: StorageKeyName): string {
  return LOCAL_KEYS[name];
}
