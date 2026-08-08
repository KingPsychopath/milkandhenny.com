import { afterEach, describe, expect, it, vi } from "vitest";

import { getTransferMediaUrlTtlSeconds } from "@/features/transfers/media-access";
import {
  getVideoPosterMaxBytes,
  ProcessingTimeoutError,
  withProcessingTimeout,
} from "@/features/transfers/media-processing-config.server";

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

describe("video poster cap", () => {
  it("defaults to 2 GiB", () => {
    expect(getVideoPosterMaxBytes()).toBe(2 * 1024 * 1024 * 1024);
  });

  it("is configurable, and 0 disables the cap", () => {
    vi.stubEnv("MEDIA_VIDEO_POSTER_MAX_BYTES", "1024");
    expect(getVideoPosterMaxBytes()).toBe(1024);

    vi.stubEnv("MEDIA_VIDEO_POSTER_MAX_BYTES", "0");
    expect(getVideoPosterMaxBytes()).toBe(0);
  });
});

describe("withProcessingTimeout", () => {
  it("passes work through untouched when no budget is set", async () => {
    await expect(withProcessingTimeout("job", 0, async () => "done")).resolves.toBe("done");
  });

  it("rejects work that outruns its budget", async () => {
    const slow = () => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 50));
    await expect(withProcessingTimeout("job", 5, slow)).rejects.toBeInstanceOf(
      ProcessingTimeoutError,
    );
  });

  it("resolves work that finishes in time", async () => {
    await expect(withProcessingTimeout("job", 1000, async () => "quick")).resolves.toBe("quick");
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

    for (const code of ["raw_preview_unavailable", "video_too_large_for_poster"]) {
      const file = {
        processingStatus: "failed" as const,
        retryCount: 0,
        processingErrorCode: code,
      };
      expect(isTerminalProcessingFailure(file)).toBe(true);
      expect(canRetryTransferProcessing(file)).toBe(false);
    }
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
