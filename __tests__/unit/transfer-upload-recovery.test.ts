import { describe, expect, it, vi } from "vitest";

import {
  clearTransferUploadRecovery,
  clearLastTransferResult,
  getRecoverySelectionState,
  getRecoveryStorageState,
  readLastTransferResult,
  readTransferUploadRecovery,
  orderSourceFilesForRecovery,
  saveLastTransferResult,
  saveTransferUploadRecovery,
  sourceFilesMatch,
} from "@/features/transfers/ui/upload/recovery";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

function file(name = "archive.zip", lastModified = 123): File {
  return new File(["data"], name, { type: "application/zip", lastModified });
}

describe("transfer upload recovery", () => {
  it("only treats a checkpoint as resumable after at least one file completes", () => {
    expect(getRecoveryStorageState(0, 1)).toBe("empty");
    expect(getRecoveryStorageState(1, 1)).toBe("partial");
    expect(getRecoveryStorageState(1, 0)).toBe("complete");
  });

  it("restores a short-lived tab-scoped upload checkpoint", () => {
    vi.setSystemTime(new Date("2026-09-02T12:00:00Z"));
    const storage = memoryStorage();
    const saved = saveTransferUploadRecovery(
      {
        transferId: "velvet-moon-candle",
        deleteToken: "secret",
        title: "archive",
        expiry: "7d",
        expiresSeconds: 604_800,
        sourceFiles: [file()],
        files: [{ name: "archive.zip", size: 4, type: "application/zip", mediaId: "media-1" }],
      },
      storage,
    );

    expect(readTransferUploadRecovery(storage)).toEqual(saved);
    expect(sourceFilesMatch([file()], saved!.sourceFiles)).toBe(true);
    expect(
      orderSourceFilesForRecovery(
        [file("second.zip", 456), file()],
        [
          ...saved!.sourceFiles,
          { name: "second.zip", size: 4, type: "application/zip", lastModified: 456 },
        ],
      )?.map((value) => value.name),
    ).toEqual(["archive.zip", "second.zip"]);
    expect(sourceFilesMatch([file("other.zip")], saved!.sourceFiles)).toBe(false);
    expect(getRecoverySelectionState([], saved!.sourceFiles)).toBe("missing");
    expect(getRecoverySelectionState([file()], saved!.sourceFiles)).toBe("matches");
    expect(getRecoverySelectionState([file("other.zip")], saved!.sourceFiles)).toBe("mismatch");
  });

  it("keeps same-page recovery when session storage is unavailable", () => {
    const unavailableStorage = memoryStorage();
    unavailableStorage.setItem = () => {
      throw new Error("storage unavailable");
    };

    const saved = saveTransferUploadRecovery(
      {
        transferId: "velvet-moon-candle",
        deleteToken: "secret",
        title: "archive",
        expiry: "7d",
        expiresSeconds: 604_800,
        sourceFiles: [file()],
        files: [{ name: "archive.zip", size: 4 }],
      },
      unavailableStorage,
    );

    expect(saved?.transferId).toBe("velvet-moon-candle");
  });

  it("drops expired or explicitly discarded recovery state", () => {
    vi.setSystemTime(new Date("2026-09-02T12:00:00Z"));
    const storage = memoryStorage();
    saveTransferUploadRecovery(
      {
        transferId: "velvet-moon-candle",
        deleteToken: "secret",
        title: "archive",
        expiry: "7d",
        expiresSeconds: 604_800,
        sourceFiles: [file()],
        files: [{ name: "archive.zip", size: 4 }],
      },
      storage,
    );

    expect(readTransferUploadRecovery(storage, Date.now() + 7 * 60 * 60 * 1000)).toBeNull();
    saveTransferUploadRecovery(
      {
        transferId: "velvet-moon-candle",
        deleteToken: "secret",
        title: "archive",
        expiry: "7d",
        expiresSeconds: 604_800,
        sourceFiles: [file()],
        files: [{ name: "archive.zip", size: 4 }],
      },
      storage,
    );
    clearTransferUploadRecovery(storage);
    expect(readTransferUploadRecovery(storage)).toBeNull();
  });

  it("keeps the management link available after a refresh in the same tab", () => {
    const storage = memoryStorage();
    const result = {
      shareUrl: "https://example.com/t/transfer",
      adminUrl: "https://example.com/t/transfer#secret",
      transfer: {
        id: "transfer",
        title: "archive",
        fileCount: 1,
        expiresAt: "2026-09-09T12:00:00Z",
      },
      totalSize: 4,
      fileCounts: { images: 0, videos: 0, gifs: 0, audio: 0, other: 1 },
    };

    saveLastTransferResult(result, storage);
    expect(readLastTransferResult(storage)).toEqual(result);
    expect(readLastTransferResult(storage, Date.parse("2026-09-10T00:00:00Z"))).toBeNull();
    expect(storage.length).toBe(0);
    saveLastTransferResult(result, storage);
    clearLastTransferResult(storage);
    expect(readLastTransferResult(storage)).toBeNull();
  });
});
