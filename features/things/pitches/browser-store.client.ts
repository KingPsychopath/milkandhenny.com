import type { BinaryFiles } from "@excalidraw/excalidraw/types";

import { PITCH_SLIDE_LIMIT_RANGE, type PitchDocument, type PitchOwnerCredential } from "./types";
import { parsePitchDocument } from "./validation";

const DATABASE = "milk-and-henny-pitches";
const VERSION = 1;
const CREDENTIALS = "credentials";
const DRAFTS = "drafts";

export interface LocalPitchDraft {
  deckId: string;
  title: string;
  document: PitchDocument;
  files: BinaryFiles;
  serverVersion: number;
  updatedAt: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CREDENTIALS)) {
        database.createObjectStore(CREDENTIALS, { keyPath: "deckId" });
      }
      if (!database.objectStoreNames.contains(DRAFTS)) {
        database.createObjectStore(DRAFTS, { keyPath: "deckId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local pitches"));
  });
}

async function transact<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local pitch storage failed"));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Local pitch storage failed"));
  });
}

export function rememberPitchCredential(credential: PitchOwnerCredential): Promise<IDBValidKey> {
  return transact(CREDENTIALS, "readwrite", (store) => store.put(credential));
}

export function readPitchCredential(deckId: string): Promise<PitchOwnerCredential | undefined> {
  return transact(CREDENTIALS, "readonly", (store) => store.get(deckId));
}

export function listPitchCredentials(): Promise<PitchOwnerCredential[]> {
  return transact(CREDENTIALS, "readonly", (store) => store.getAll());
}

export function saveLocalPitchDraft(draft: LocalPitchDraft): Promise<IDBValidKey> {
  return transact(DRAFTS, "readwrite", (store) => store.put(draft));
}

export async function readLocalPitchDraft(deckId: string): Promise<LocalPitchDraft | undefined> {
  const value: unknown = await transact(DRAFTS, "readonly", (store) => store.get(deckId));
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const document = parsePitchDocument(source.document, PITCH_SLIDE_LIMIT_RANGE.max);
  if (
    source.deckId !== deckId ||
    typeof source.title !== "string" ||
    typeof source.serverVersion !== "number" ||
    !Number.isInteger(source.serverVersion) ||
    typeof source.updatedAt !== "string" ||
    !document.ok ||
    !source.files ||
    typeof source.files !== "object" ||
    Array.isArray(source.files)
  ) {
    return undefined;
  }
  return {
    deckId,
    title: source.title,
    document: document.document,
    files: source.files as BinaryFiles,
    serverVersion: source.serverVersion,
    updatedAt: source.updatedAt,
  };
}

export async function rememberTokenFromHash(
  deckId: string,
  fallbackTitle = "Untitled pitch",
  fallbackName = "",
): Promise<PitchOwnerCredential | undefined> {
  const existing = await readPitchCredential(deckId).catch(() => undefined);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = hash.get("key");
  if (!token) return existing;

  const credential: PitchOwnerCredential = {
    deckId,
    token,
    title: existing?.title ?? fallbackTitle,
    ownerName: existing?.ownerName ?? fallbackName,
    updatedAt: new Date().toISOString(),
  };
  await rememberPitchCredential(credential);
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return credential;
}
