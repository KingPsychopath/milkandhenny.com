interface ExpiringValue<T> {
  expiresAt: number;
  value: T;
}

const GAME_PREFIXES = ["things:remote:", "things:spelling-party:", "things:draw-country:"];

export function readExpiringLocalValue<T>(key: string): T | null {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<ExpiringValue<T>> | null;
    if (!stored || typeof stored.expiresAt !== "number" || stored.expiresAt <= Date.now() || !("value" in stored)) {
      localStorage.removeItem(key);
      return null;
    }
    return stored.value as T;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

export function writeExpiringLocalValue<T>(key: string, value: T, expiresAt: number) {
  localStorage.setItem(key, JSON.stringify({ expiresAt, value } satisfies ExpiringValue<T>));
}

export function migrateSessionValue(currentKey: string, legacyKeys: string[]) {
  const current = sessionStorage.getItem(currentKey);
  if (current !== null) return current;
  for (const legacyKey of legacyKeys) {
    const legacy = sessionStorage.getItem(legacyKey);
    if (legacy === null) continue;
    sessionStorage.setItem(currentKey, legacy);
    sessionStorage.removeItem(legacyKey);
    return legacy;
  }
  return null;
}

export function removeStorageKeys(storage: Storage, keys: string[]) {
  for (const key of keys) storage.removeItem(key);
}

export function removeStoragePrefix(storage: Storage, prefix: string) {
  const matches: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) matches.push(key);
  }
  removeStorageKeys(storage, matches);
}

export function clearExpiredGameLocalStorage() {
  const expired: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !GAME_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? "null") as { expiresAt?: unknown } | null;
      if (!stored || typeof stored.expiresAt !== "number" || stored.expiresAt <= Date.now()) expired.push(key);
    } catch {
      expired.push(key);
    }
  }
  removeStorageKeys(localStorage, expired);
}
