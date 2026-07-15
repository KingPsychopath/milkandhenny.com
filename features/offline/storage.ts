const DATABASE_NAME = "milkandhenny-things";
const DATABASE_VERSION = 1;
const STORE_NAME = "thing-data";

interface ThingDataRecord {
  key: string;
  schemaVersion: number;
  updatedAt: number;
  value: unknown;
}

function openThingsDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to open offline storage"));
    request.onblocked = () =>
      reject(new Error("Offline storage upgrade is blocked"));
  });
}

export async function readThingData(
  key: string,
): Promise<ThingDataRecord | null> {
  const database = await openThingsDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(key);
      request.onsuccess = () => {
        const value: unknown = request.result;
        if (!value || typeof value !== "object") return resolve(null);
        const record = value as Partial<ThingDataRecord>;
        if (
          record.key !== key ||
          typeof record.schemaVersion !== "number" ||
          typeof record.updatedAt !== "number"
        ) {
          return resolve(null);
        }
        resolve({
          key,
          schemaVersion: record.schemaVersion,
          updatedAt: record.updatedAt,
          value: record.value,
        });
      };
      request.onerror = () =>
        reject(request.error ?? new Error("Unable to read offline data"));
    });
  } finally {
    database.close();
  }
}

export async function writeThingData(
  key: string,
  schemaVersion: number,
  value: unknown,
): Promise<void> {
  const database = await openThingsDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction
        .objectStore(STORE_NAME)
        .put({ key, schemaVersion, updatedAt: Date.now(), value });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Unable to save offline data"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Offline data save was aborted"));
    });
  } finally {
    database.close();
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
