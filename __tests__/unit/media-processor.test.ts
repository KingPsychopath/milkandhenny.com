import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("media processor selection", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

    vi.doMock("@/features/media/config.server", () => ({
      getMediaProcessorMode: () => "local",
    }));
    vi.doMock("@/features/transfers/media-backends/local.server", () => ({
      createLocalMediaProcessor: () => localProcessor,
    }));
    vi.doMock("@/features/transfers/media-backends/hybrid.server", () => ({
      createHybridMediaProcessor: vi.fn(() => hybridProcessor),
    }));

    const { getMediaProcessor } = await import("@/features/transfers/media-processor.server");
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

    vi.doMock("@/features/media/config.server", () => ({
      getMediaProcessorMode: () => "hybrid",
    }));
    vi.doMock("@/features/transfers/media-backends/local.server", () => ({
      createLocalMediaProcessor: () => localProcessor,
    }));
    vi.doMock("@/features/transfers/media-backends/hybrid.server", () => ({
      createHybridMediaProcessor,
    }));

    const { getMediaProcessor } = await import("@/features/transfers/media-processor.server");
    expect(getMediaProcessor()).toBe(hybridProcessor);
    expect(createHybridMediaProcessor).toHaveBeenCalledWith();
  });

  it("rejects obsolete processor modes", async () => {
    vi.stubEnv("MEDIA_PROCESSOR_MODE", "worker");
    vi.doUnmock("@/features/media/config.server");
    const { getMediaProcessorMode } = await import("@/features/media/config.server");
    expect(() => getMediaProcessorMode()).toThrow(/local or hybrid/);
  });
});
