import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const pendingClaims = new Map<object, (error: Error) => void>();
  const clients: Array<{ disconnect: ReturnType<typeof vi.fn> }> = [];
  const claim = vi.fn((client: object, timeoutSeconds: number) => {
    void timeoutSeconds;
    return new Promise<null>((_resolve, reject) => pendingClaims.set(client, reject));
  });
  return { claim, clients, pendingClaims };
});

vi.mock("@/features/media/config.server", () => ({
  getMediaProcessorMode: () => "hybrid",
}));

vi.mock("@/features/transfers/media-backends/worker.server", () => ({
  processWorkerJob: vi.fn(),
}));

vi.mock("@/features/transfers/media-queue.server", () => ({
  ackTransferMediaJob: vi.fn(),
  claimTransferMediaJobBlocking: state.claim,
  recoverTransferMediaProcessingJobs: vi.fn().mockResolvedValue(0),
  requeueTransferMediaJob: vi.fn(),
}));

vi.mock("@/features/transfers/media-reconcile.server", () => ({
  reconcileTransferMedia: vi.fn().mockResolvedValue({ filesRepaired: 0, transfersRepaired: 0 }),
}));

vi.mock("@/features/transfers/media-worker-status.server", () => ({
  updateTransferMediaWorkerStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/platform/redis-direct.server", () => ({
  createDirectRedisClient: vi.fn(() => {
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

afterEach(async () => {
  const { stopMediaWorkerLoop } = await import("@/features/system/media-worker-runtime.server");
  await stopMediaWorkerLoop();
  state.claim.mockClear();
  state.clients.length = 0;
  state.pendingClaims.clear();
});

describe("long-running media worker", () => {
  it("holds one indefinite blocking claim per concurrency slot while idle", async () => {
    const { startMediaWorkerLoop, stopMediaWorkerLoop } =
      await import("@/features/system/media-worker-runtime.server");

    startMediaWorkerLoop({ concurrency: 2 });

    await vi.waitFor(() => expect(state.claim).toHaveBeenCalledTimes(2));
    expect(state.clients).toHaveLength(2);
    expect(state.claim.mock.calls.map(([, timeout]) => timeout)).toEqual([0, 0]);
    expect(new Set(state.claim.mock.calls.map(([client]) => client)).size).toBe(2);

    await stopMediaWorkerLoop();

    expect(state.claim).toHaveBeenCalledTimes(2);
    expect(state.clients.every((client) => client.disconnect.mock.calls.length === 1)).toBe(true);
  });
});
