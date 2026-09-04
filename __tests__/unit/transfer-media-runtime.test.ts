import { afterEach, describe, expect, it, vi } from "vitest";

import { getTransferMediaUrlTtlSeconds } from "@/features/transfers/media-access";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signed media URL lifetimes", () => {
  it("gives streamed originals a window long enough to seek in", () => {
    // A `<video>` re-requests byte ranges on seek; a 60s signature would 403
    // partway through a clip.
    expect(getTransferMediaUrlTtlSeconds("primary")).toBe(3600);
    expect(getTransferMediaUrlTtlSeconds("original")).toBe(3600);
  });

  it("keeps derivative URLs short-lived", () => {
    expect(getTransferMediaUrlTtlSeconds("thumb")).toBe(60);
    expect(getTransferMediaUrlTtlSeconds("full")).toBe(60);
  });
});

describe("media role", () => {
  it("defaults to the web role", async () => {
    vi.resetModules();
    const { getMediaRole, isMediaWorkerRole } = await import("@/features/system/media-role.server");
    expect(getMediaRole()).toBe("web");
    expect(isMediaWorkerRole()).toBe(false);
  });

  it("recognises the worker role", async () => {
    vi.stubEnv("MEDIA_WORKER_ROLE", "worker");
    vi.resetModules();
    const { isMediaWorkerRole } = await import("@/features/system/media-role.server");
    expect(isMediaWorkerRole()).toBe(true);
  });

  it("refuses an unknown role rather than silently serving web", async () => {
    vi.stubEnv("MEDIA_WORKER_ROLE", "wrker");
    vi.resetModules();
    const { getMediaRole } = await import("@/features/system/media-role.server");
    expect(() => getMediaRole()).toThrow(/MEDIA_WORKER_ROLE/);
  });
});

describe("terminal processing failures", () => {
  it("never retries a failure the file itself guarantees", async () => {
    const { canRetryTransferProcessing, isTerminalProcessingFailure } =
      await import("@/features/transfers/media-state");

    for (const code of ["raw_preview_unavailable"]) {
      const file = {
        processingStatus: "failed" as const,
        retryCount: 0,
        processingErrorCode: code,
      };
      expect(isTerminalProcessingFailure(file)).toBe(true);
      expect(canRetryTransferProcessing(file)).toBe(false);
    }
  });

  it("retries videos skipped by the retired poster-size cap", async () => {
    const { canRetryTransferProcessing, isTerminalProcessingFailure } =
      await import("@/features/transfers/media-state");
    const file = {
      processingStatus: "failed" as const,
      retryCount: 0,
      processingErrorCode: "video_too_large_for_poster",
    };

    expect(isTerminalProcessingFailure(file)).toBe(false);
    expect(canRetryTransferProcessing(file)).toBe(true);
  });

  it("still retries failures that a later attempt could fix", async () => {
    const { canRetryTransferProcessing } = await import("@/features/transfers/media-state");

    expect(
      canRetryTransferProcessing({
        processingStatus: "failed",
        retryCount: 0,
        processingErrorCode: "worker_failed",
      }),
    ).toBe(true);
  });

  it("stops retrying once the attempt budget is spent", async () => {
    const { canRetryTransferProcessing } = await import("@/features/transfers/media-state");

    expect(
      canRetryTransferProcessing({
        processingStatus: "failed",
        retryCount: 3,
        processingErrorCode: "worker_failed",
      }),
    ).toBe(false);
  });
});
