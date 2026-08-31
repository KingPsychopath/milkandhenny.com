interface ExpiringValue<T> {
  expiresAt: number;
  value: T;
}

const GAME_PREFIXES = [
  "things:remote:",
  "things:spelling-party:",
  "things:draw-country:",
  "things:liars:",
  "things:heads-up:",
  "things:spelling-bee:",
  "things:hot-and-cold:",
  "things:twin:",
  "things:centre:",
  "things:same-brain:",
  "things:game-pool:",
  "things:family-feud:",
  "pitch-remote:",
];

export function readStorageValue(storage: Storage, key: string) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorageValue(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function readExpiringLocalValue<T>(key: string): T | null {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<
      ExpiringValue<T>
    > | null;
    if (
      !stored ||
      typeof stored.expiresAt !== "number" ||
      stored.expiresAt <= Date.now() ||
      !("value" in stored)
    ) {
      removeStorageKeys(localStorage, [key]);
      return null;
    }
    return stored.value as T;
  } catch {
    removeStorageKeys(localStorage, [key]);
    return null;
  }
}

export function writeExpiringLocalValue<T>(key: string, value: T, expiresAt: number) {
  // Storage is recovery, not game authority. A full or blocked store must never stop play.
  return writeStorageValue(
    localStorage,
    key,
    JSON.stringify({ expiresAt, value } satisfies ExpiringValue<T>),
  );
}

export function removeStorageKeys(storage: Storage, keys: string[]) {
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // A private browser may expose Storage while rejecting every operation.
    }
  }
}

export function removeStoragePrefix(storage: Storage, prefix: string) {
  const matches: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) matches.push(key);
    }
  } catch {
    return;
  }
  removeStorageKeys(storage, matches);
}

/**
 * Clears out room sessions whose rooms have expired.
 *
 * It removes **only** records that are expiring records and have expired. It used to delete
 * anything under a game prefix that it could not parse as one, which quietly took everything else
 * a game keeps with it: preferences, notepads, and the sound setting — the last of which is a bare
 * string, so parsing it threw and it was removed on sight. Opening one game wiped another's
 * settings, which reads exactly like "it never remembers anything".
 */
export function clearExpiredGameLocalStorage() {
  const expired: string[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !GAME_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
      let stored: unknown;
      try {
        stored = JSON.parse(localStorage.getItem(key) ?? "null");
      } catch {
        // Not JSON, so not one of ours to expire. Leave it alone.
        continue;
      }
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) continue;
      const expiresAt = (stored as { expiresAt?: unknown }).expiresAt;
      // No expiry means it was never meant to have one.
      if (typeof expiresAt !== "number") continue;
      if (expiresAt <= Date.now()) expired.push(key);
    }
  } catch {
    return;
  }
  removeStorageKeys(localStorage, expired);
}
