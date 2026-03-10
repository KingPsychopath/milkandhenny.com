import { beforeEach, describe, expect, it, vi } from "vitest";

describe("media processor selection", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns the local processor in local mode", async () => {
    const localProcessor = {
      processTransferBuffer: vi.fn(),
      processTransferObject: vi.fn(),
      backfillTransferMedia: vi.fn(),
    };
    const hybridProcessor = {
      processTransferBuffer: vi.fn(),
      processTransferObject: vi.fn(),
      backfillTransferMedia: vi.fn(),
    };

    vi.doMock("@/features/media/config", () => ({
      getMediaProcessorMode: () => "local",
    }));
    vi.doMock("@/features/media/backends/local", () => ({
      createLocalMediaProcessor: () => localProcessor,
    }));
    vi.doMock("@/features/media/backends/hybrid", () => ({
      createHybridMediaProcessor: vi.fn(() => hybridProcessor),
    }));

    const { getMediaProcessor } = await import("@/features/media/processor");
    expect(getMediaProcessor()).toBe(localProcessor);
  });

  it("returns the hybrid processor in hybrid mode", async () => {
    const localProcessor = {
      processTransferBuffer: vi.fn(),
      processTransferObject: vi.fn(),
      backfillTransferMedia: vi.fn(),
    };
    const hybridProcessor = {
      processTransferBuffer: vi.fn(),
      processTransferObject: vi.fn(),
      backfillTransferMedia: vi.fn(),
    };
    const createHybridMediaProcessor = vi.fn(() => hybridProcessor);

    vi.doMock("@/features/media/config", () => ({
      getMediaProcessorMode: () => "hybrid",
    }));
    vi.doMock("@/features/media/backends/local", () => ({
      createLocalMediaProcessor: () => localProcessor,
    }));
    vi.doMock("@/features/media/backends/hybrid", () => ({
      createHybridMediaProcessor,
    }));

    const { getMediaProcessor } = await import("@/features/media/processor");
    expect(getMediaProcessor()).toBe(hybridProcessor);
    expect(createHybridMediaProcessor).toHaveBeenCalledWith("hybrid");
  });

  it("returns the hybrid worker-backed processor in worker mode", async () => {
    const hybridProcessor = {
      processTransferBuffer: vi.fn(),
      processTransferObject: vi.fn(),
      backfillTransferMedia: vi.fn(),
    };
    const createHybridMediaProcessor = vi.fn(() => hybridProcessor);

    vi.doMock("@/features/media/config", () => ({
      getMediaProcessorMode: () => "worker",
    }));
    vi.doMock("@/features/media/backends/local", () => ({
      createLocalMediaProcessor: vi.fn(),
    }));
    vi.doMock("@/features/media/backends/hybrid", () => ({
      createHybridMediaProcessor,
    }));

    const { getMediaProcessor } = await import("@/features/media/processor");
    expect(getMediaProcessor()).toBe(hybridProcessor);
    expect(createHybridMediaProcessor).toHaveBeenCalledWith("worker");
  });
});
