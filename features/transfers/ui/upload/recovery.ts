import type { TransferUploadFileInput } from "@/features/transfers/upload-types";

const RECOVERY_KEY = "mah:transfer-upload-recovery:v1";
const LAST_RESULT_KEY = "mah:last-transfer-result:v1";
const RECOVERY_MAX_AGE_MS = 6.5 * 60 * 60 * 1000;

export type SourceFile = {
  name: string;
  size: number;
  type: string;
  lastModified: number;
};

export type RecoverySelectionState = "missing" | "matches" | "mismatch";
export type RecoveryStorageState = "empty" | "partial" | "complete";

export type TransferUploadRecovery = {
  version: 1;
  createdAt: number;
  transferId: string;
  deleteToken: string;
  title: string;
  expiry: string;
  expiresSeconds: number;
  sourceFiles: SourceFile[];
  files: TransferUploadFileInput[];
};

export type SavedTransferResult = {
  shareUrl: string;
  adminUrl: string;
  transfer: {
    id: string;
    title: string;
    fileCount: number;
    expiresAt: string;
  };
  totalSize: number;
  transferTotalSize?: number;
  fileCounts: {
    images: number;
    videos: number;
    gifs: number;
    audio: number;
    other: number;
  };
  processingCounts?: {
    readyCount: number;
    queuedCount: number;
    failedCount: number;
    skippedCount: number;
    originalOnlyCount: number;
  };
  addedCount?: number;
};

function sourceFile(file: File): SourceFile {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
  };
}

export function sourceFilesMatch(files: File[], expected: SourceFile[]): boolean {
  return orderSourceFilesForRecovery(files, expected) !== null;
}

export function getRecoverySelectionState(
  files: File[],
  expected: SourceFile[],
): RecoverySelectionState {
  if (files.length === 0) return "missing";
  return sourceFilesMatch(files, expected) ? "matches" : "mismatch";
}

export function getRecoveryStorageState(
  uploadedFileCount: number,
  missingUploadCount: number,
): RecoveryStorageState {
  if (missingUploadCount === 0) return "complete";
  return uploadedFileCount === 0 ? "empty" : "partial";
}

export function getTransferUploadRecoveryExpiresAt(recovery: TransferUploadRecovery): number {
  return recovery.createdAt + RECOVERY_MAX_AGE_MS;
}

export function orderSourceFilesForRecovery(files: File[], expected: SourceFile[]): File[] | null {
  if (files.length !== expected.length) return null;
  const remaining = [...files];
  const ordered: File[] = [];
  for (const saved of expected) {
    const index = remaining.findIndex(
      (file) =>
        file.name === saved?.name &&
        file.size === saved.size &&
        file.type === saved.type &&
        file.lastModified === saved.lastModified,
    );
    if (index < 0) return null;
    ordered.push(remaining.splice(index, 1)[0]!);
  }
  return ordered;
}

function isRecovery(value: unknown, now: number): value is TransferUploadRecovery {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const recovery = value as Partial<TransferUploadRecovery>;
  return (
    recovery.version === 1 &&
    typeof recovery.createdAt === "number" &&
    now - recovery.createdAt >= 0 &&
    now - recovery.createdAt <= RECOVERY_MAX_AGE_MS &&
    typeof recovery.transferId === "string" &&
    typeof recovery.deleteToken === "string" &&
    typeof recovery.title === "string" &&
    typeof recovery.expiry === "string" &&
    typeof recovery.expiresSeconds === "number" &&
    Array.isArray(recovery.sourceFiles) &&
    Array.isArray(recovery.files)
  );
}

export function readTransferUploadRecovery(
  storage: Storage = window.sessionStorage,
  now = Date.now(),
): TransferUploadRecovery | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(RECOVERY_KEY) ?? "null");
    if (isRecovery(value, now)) return value;
    storage.removeItem(RECOVERY_KEY);
  } catch {
    try {
      storage.removeItem(RECOVERY_KEY);
    } catch {
      // Storage can be unavailable in a private browser context.
    }
  }
  return null;
}

export function saveTransferUploadRecovery(
  recovery: Omit<TransferUploadRecovery, "version" | "createdAt" | "sourceFiles"> & {
    sourceFiles: File[];
  },
  storage: Storage = window.sessionStorage,
): TransferUploadRecovery | null {
  const saved: TransferUploadRecovery = {
    ...recovery,
    version: 1,
    createdAt: Date.now(),
    sourceFiles: recovery.sourceFiles.map(sourceFile),
  };
  try {
    storage.setItem(RECOVERY_KEY, JSON.stringify(saved));
  } catch {
    // Same-page pause and retry still work when browser storage is unavailable.
  }
  return saved;
}

export function clearTransferUploadRecovery(storage: Storage = window.sessionStorage): void {
  try {
    storage.removeItem(RECOVERY_KEY);
  } catch {
    // Best-effort cleanup only.
  }
}

export function readLastTransferResult(
  storage: Storage = window.sessionStorage,
  now = Date.now(),
): SavedTransferResult | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(LAST_RESULT_KEY) ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      storage.removeItem(LAST_RESULT_KEY);
      return null;
    }
    const result = value as Partial<SavedTransferResult>;
    const valid =
      typeof result.shareUrl === "string" &&
      typeof result.adminUrl === "string" &&
      result.transfer &&
      typeof result.transfer.id === "string" &&
      typeof result.transfer.title === "string" &&
      typeof result.transfer.fileCount === "number" &&
      typeof result.transfer.expiresAt === "string" &&
      typeof result.totalSize === "number" &&
      result.fileCounts &&
      typeof result.fileCounts.other === "number" &&
      Date.parse(result.transfer.expiresAt) > now;
    if (valid) return result as SavedTransferResult;
    storage.removeItem(LAST_RESULT_KEY);
    return null;
  } catch {
    return null;
  }
}

export function saveLastTransferResult(
  result: SavedTransferResult,
  storage: Storage = window.sessionStorage,
): void {
  try {
    storage.setItem(LAST_RESULT_KEY, JSON.stringify(result));
  } catch {
    // The result remains visible until this page closes even if storage is unavailable.
  }
}

export function clearLastTransferResult(storage: Storage = window.sessionStorage): void {
  try {
    storage.removeItem(LAST_RESULT_KEY);
  } catch {
    // Best-effort cleanup only.
  }
}
