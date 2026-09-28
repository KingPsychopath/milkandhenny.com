import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const pendingClaims = new Map<object, (error: Error) => void>();
  const clients: Array<{ disconnect: ReturnType<typeof vi.fn> }> = [];
  const claim = vi.fn((client: object, timeoutSeconds: number) => {
    void timeoutSeconds;
    return new Promise<null>((_resolve, reject) => pendingClaims.set(client, reject));
  });
  return {
    ack: vi.fn().mockResolvedValue(undefined),
    claim,
    clients,
    markTimedOut: vi.fn().mockResolvedValue("failed"),
    pendingClaims,
    process: vi.fn(),
    requeue: vi.fn().mockResolvedValue({ permanent: false }),
    postgresBatch: vi.fn().mockResolvedValue({
      claimed: 0,
      completed: 0,
      retried: 0,
      obsolete: 0,
      lostClaim: 0,
    }),
  };
});

vi.mock("@/features/transfers/media-job-executor-postgres.server", () => ({
  runPostgresTransferMediaBatch: state.postgresBatch,
}));

vi.mock("@/features/transfers/media-jobs-postgres.server", () => ({
  cancelObsoletePostgresTransferMediaJobs: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/features/media/config.server", () => ({
  getMediaProcessorMode: () => "hybrid",
}));

vi.mock("@/features/transfers/media-backends/worker.server", () => ({
  forceReprocessTransferFiles: vi.fn(),
  getTransferMediaQueueLength: vi.fn().mockResolvedValue(0),
  markWorkerJobTimedOut: state.markTimedOut,
  processWorkerJob: state.process,
}));

vi.mock("@/features/transfers/media-queue.server", () => ({
  ackTransferMediaJob: state.ack,
  claimTransferMediaJobBlocking: state.claim,
  recoverTransferMediaProcessingJobs: vi.fn().mockResolvedValue(0),
  requeueTransferMediaJob: state.requeue,
  retryDeadTransferMediaJobs: vi.fn(),
}));

vi.mock("@/features/transfers/media-reconcile.server", () => ({
  reconcileTransferMedia: vi.fn().mockResolvedValue({ filesRepaired: 0, transfersRepaired: 0 }),
}));

vi.mock("@/features/transfers/media-worker-status.server", () => ({
  stopTransferMediaWorkerStatus: vi.fn().mockResolvedValue(undefined),
  updateTransferMediaWorkerStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/platform/redis-direct.server", () => ({
  createBlockingRedisClient: vi.fn(() => {
    const client = {
      disconnect: vi.fn(() => {
        state.pendingClaims.get(client)?.(new Error("connection closed"));
        state.pendingClaims.delete(client);
      }),
    };
    state.clients.push(client);
    return client;
  }),
}));

beforeEach(() => {
  state.ack.mockClear();
  state.claim.mockClear();
  state.markTimedOut.mockClear();
  state.process.mockReset();
  state.requeue.mockClear();
  state.postgresBatch.mockClear();
});

afterEach(async () => {
  const { stopMediaWorkerLoop } = await import("@/features/system/media-worker-runtime.server");
  await stopMediaWorkerLoop();
  state.clients.length = 0;
  state.pendingClaims.clear();
  vi.unstubAllEnvs();
});

describe("long-running media worker", () => {
  it("uses Postgres claims without Redis blocking clients in opt-in mode", async () => {
    vi.stubEnv("TRANSFER_MEDIA_JOB_STORE", "postgres");
    vi.stubEnv("MEDIA_WORKER_STATUS_STORE", "postgres");
    vi.stubEnv("MEDIA_RECONCILE_INTERVAL_MS", "0");
    const { startMediaWorkerLoop, stopMediaWorkerLoop } =
      await import("@/features/system/media-worker-runtime.server");

    await startMediaWorkerLoop({ concurrency: 2 });
    await vi.waitFor(() => expect(state.postgresBatch).toHaveBeenCalledTimes(2));
    expect(state.clients).toHaveLength(0);
    expect(state.claim).not.toHaveBeenCalled();

    await stopMediaWorkerLoop();
  });

  it("refuses Postgres queue mode without Postgres worker status", async () => {
    vi.stubEnv("TRANSFER_MEDIA_JOB_STORE", "postgres");
    const { startMediaWorkerLoop } = await import("@/features/system/media-worker-runtime.server");
    await expect(startMediaWorkerLoop()).rejects.toThrow("MEDIA_WORKER_STATUS_STORE=postgres");
    expect(state.postgresBatch).not.toHaveBeenCalled();
  });

  it("drains Postgres jobs and reports their outcomes", async () => {
    vi.stubEnv("TRANSFER_MEDIA_JOB_STORE", "postgres");
    vi.stubEnv("MEDIA_WORKER_STATUS_STORE", "postgres");
    state.postgresBatch.mockResolvedValueOnce({
      claimed: 1,
      completed: 1,
      retried: 0,
      obsolete: 0,
      lostClaim: 0,
    });
    const { drainMediaQueuesUntilIdle } =
      await import("@/features/system/media-worker-runtime.server");

    await expect(drainMediaQueuesUntilIdle()).resolves.toMatchObject({
      disabled: false,
      recoveredTransferJobs: 0,
      processedJobs: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
    });
    expect(state.claim).not.toHaveBeenCalled();
  });

  it("holds one indefinite blocking claim per concurrency slot while idle", async () => {
    const { startMediaWorkerLoop, stopMediaWorkerLoop } =
      await import("@/features/system/media-worker-runtime.server");

    await startMediaWorkerLoop({ concurrency: 2 });

    await vi.waitFor(() => expect(state.claim).toHaveBeenCalledTimes(2));
    expect(state.clients).toHaveLength(2);
    expect(state.claim.mock.calls.map(([, timeout]) => timeout)).toEqual([0, 0]);
    expect(new Set(state.claim.mock.calls.map(([client]) => client)).size).toBe(2);

    await stopMediaWorkerLoop();

    expect(state.claim).toHaveBeenCalledTimes(2);
    expect(state.clients.every((client) => client.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it("records and acknowledges a timed-out job without starting a duplicate attempt", async () => {
    vi.stubEnv("MEDIA_WORKER_JOB_TIMEOUT_MS", "10");
    const job = {
      transferId: "transfer-1",
      file: { name: "clip.mov", size: 10, type: "video/quicktime" },
      storageKey: "transfers/transfer-1/original/clip.mov",
      mimeType: "video/quicktime",
      processingRoute: "worker_video",
      attempt: 1,
      enqueuedAt: new Date().toISOString(),
    };
    state.claim.mockResolvedValueOnce({ raw: "claimed-job", job, lockedUntil: "later" } as never);
    state.process.mockImplementationOnce(
      (_job: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const { startMediaWorkerLoop, stopMediaWorkerLoop } =
      await import("@/features/system/media-worker-runtime.server");

    await startMediaWorkerLoop({ concurrency: 1, errorBackoffMs: 1 });
    await vi.waitFor(() => expect(state.markTimedOut).toHaveBeenCalledWith(job, 10));
    await vi.waitFor(() => expect(state.ack).toHaveBeenCalledWith("claimed-job"));

    expect(state.process).toHaveBeenCalledOnce();
    expect(state.requeue).not.toHaveBeenCalled();
    await stopMediaWorkerLoop();
  });
});
