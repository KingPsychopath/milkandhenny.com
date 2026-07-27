import { beforeEach, describe, expect, it, vi } from "vitest";

const { backfillTransferMedia, listTransferData, redisSet, redisDel } = vi.hoisted(() => ({
  backfillTransferMedia: vi.fn(),
  listTransferData: vi.fn(),
  redisSet: vi.fn(),
  redisDel: vi.fn(),
}));

vi.mock("@/features/transfers/media-processor.server", () => ({
  getMediaProcessor: () => ({ backfillTransferMedia }),
}));

vi.mock("@/features/transfers/store.server", () => ({ listTransferData }));

vi.mock("@/lib/platform/redis.server", () => ({
  getRedis: () => ({ set: redisSet, del: redisDel }),
}));

const STALE_MS = 16 * 60 * 1000;

function transferWith(files: Array<Record<string, unknown>>) {
  return {
    id: "transfer-1",
    title: "transfer",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    deleteToken: "token",
    files,
  };
}

const readyFile = {
  id: "photo",
  filename: "photo.jpg",
  kind: "image",
  size: 1024,
  mimeType: "image/jpeg",
  storageKey: "transfers/transfer-1/originals/photo.jpg",
  previewStatus: "ready",
  processingStatus: "local_done",
  processingRoute: "local_image",
};

describe("transfer media reconciliation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    redisSet.mockResolvedValue("OK");
    redisDel.mockResolvedValue(1);
    backfillTransferMedia.mockImplementation(async (transfer) => transfer);
  });

  it("leaves a healthy transfer alone without touching object storage", async () => {
    listTransferData.mockResolvedValue([transferWith([readyFile])]);

    const { reconcileTransferMedia } = await import("@/features/transfers/media-reconcile.server");
    const result = await reconcileTransferMedia();

    expect(result.ran).toBe(true);
    expect(result.transfersScanned).toBe(1);
    expect(backfillTransferMedia).not.toHaveBeenCalled();
  });

  it("repairs a file left claimed by a worker that died", async () => {
    const stuck = transferWith([
      {
        ...readyFile,
        previewStatus: "original_only",
        processingStatus: "processing",
        processingRoute: "worker_video",
        processingStartedAt: new Date(Date.now() - STALE_MS).toISOString(),
      },
    ]);
    listTransferData.mockResolvedValue([stuck]);
    backfillTransferMedia.mockResolvedValue(transferWith([readyFile]));

    const { reconcileTransferMedia } = await import("@/features/transfers/media-reconcile.server");
    const result = await reconcileTransferMedia();

    expect(backfillTransferMedia).toHaveBeenCalledWith(stuck);
    expect(result.transfersRepaired).toBe(1);
    expect(result.filesRepaired).toBe(1);
  });

  it("repairs a file whose processing state was never recorded", async () => {
    listTransferData.mockResolvedValue([
      transferWith([{ ...readyFile, previewStatus: undefined, processingStatus: undefined }]),
    ]);

    const { reconcileTransferMedia } = await import("@/features/transfers/media-reconcile.server");
    await reconcileTransferMedia();

    expect(backfillTransferMedia).toHaveBeenCalled();
  });

  it("does not re-attempt a failure the file itself guarantees", async () => {
    listTransferData.mockResolvedValue([
      transferWith([
        {
          ...readyFile,
          filename: "capture.dng",
          previewStatus: "original_only",
          processingStatus: "failed",
          processingRoute: "raw_try_local",
          processingErrorCode: "raw_preview_unavailable",
          retryCount: 0,
        },
      ]),
    ]);

    const { reconcileTransferMedia } = await import("@/features/transfers/media-reconcile.server");
    await reconcileTransferMedia();

    expect(backfillTransferMedia).not.toHaveBeenCalled();
  });

  it("stands down when another sweep holds the lock", async () => {
    redisSet.mockResolvedValue(null);

    const { reconcileTransferMedia } = await import("@/features/transfers/media-reconcile.server");
    const result = await reconcileTransferMedia();

    expect(result).toMatchObject({ ran: false, reason: "locked" });
    expect(listTransferData).not.toHaveBeenCalled();
  });

  it("releases the lock even when a transfer blows up", async () => {
    listTransferData.mockResolvedValue([
      transferWith([{ ...readyFile, previewStatus: undefined, processingStatus: undefined }]),
    ]);
    backfillTransferMedia.mockRejectedValue(new Error("R2 unreachable"));

    const { reconcileTransferMedia, RECONCILE_LOCK_KEY } =
      await import("@/features/transfers/media-reconcile.server");
    const result = await reconcileTransferMedia();

    // One bad transfer must not abort the sweep or strand the lock for the
    // full TTL — the next sweep would otherwise be blocked for ten minutes.
    expect(result.ran).toBe(true);
    expect(result.transfersRepaired).toBe(0);
    expect(redisDel).toHaveBeenCalledWith(RECONCILE_LOCK_KEY);
  });
});
