import type { CentreDifficulty, CentreRoute } from "./types";

export interface SoloCentreReplay {
  id: string;
  seed: number;
  difficulty: CentreDifficulty;
  mazeHash: string;
  elapsedMs: number;
  route: CentreRoute;
  savedAt: number;
}

const DATABASE = "milkandhenny-centre-v1";
const STORE = "replays";

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("savedAt", "savedAt");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestValue<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function recentSoloCentreReplays() {
  if (typeof indexedDB === "undefined") return [];
  const db = await database();
  try {
    const transaction = db.transaction(STORE, "readonly");
    const records = await requestValue(transaction.objectStore(STORE).getAll());
    return (records as SoloCentreReplay[]).toSorted((left, right) => right.savedAt - left.savedAt);
  } finally {
    db.close();
  }
}

export async function saveSoloCentreReplay(replay: SoloCentreReplay) {
  if (typeof indexedDB === "undefined") return;
  const db = await database();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    store.put(replay);
    const records = (await requestValue(store.getAll())) as SoloCentreReplay[];
    for (const old of records.toSorted((left, right) => right.savedAt - left.savedAt).slice(10))
      store.delete(old.id);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
